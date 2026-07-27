---
title: "Vite dev server 走 cloudflared 临时隧道给手机验收：allowedHosts 的坑"
description: "本地起 Vite dev server，想让手机 / 别的网络直接摸一下产物，为什么 cloudflared 隧道通了但打开是 Blocked request，一次配置永久受益。"
date: 2026-07-27
tags: ["vite", "cloudflared", "tunnel", "dev-server", "cross-device"]
---

## 场景

本地 mac 起了 Vite dev server（`pnpm dev`, 默认 5173），想让手机或其他设备直接打开验收 —— 不想 build 后 deploy 到 CF Pages 再看，也不想去搞 LAN IP + 防火墙。

最轻的方案是 **cloudflared 临时隧道**（不需要账号、不需要域名）：

```bash
cloudflared tunnel --url http://localhost:5173
```

跑起来会分配一个 `xxx-xxx-xxx-xxx.trycloudflare.com` 的临时域名，任何网络下点开都能直连到你 mac 上的 dev server。

## 踩的坑

隧道进程日志显示 200 OK，但从手机 / 从外部 curl 打开这个 trycloudflare URL，返回：

```
Blocked request. This host ("dave-hollow-expansys-performing.trycloudflare.com")
is not allowed. To allow this host, add "dave-hollow-expansys-performing.trycloudflare.com"
to `server.allowedHosts` in vite.config.js.
```

**根因**：Vite 5 默认开了 [Host header 校验](https://vitejs.dev/config/server-options.html#server-allowedhosts)，只允许 `localhost` 和 `127.0.0.1`。cloudflared 转发过来的请求 `Host` header 是那个 `trycloudflare.com` 域名，Vite 直接拒。

这是 CVE-2025-31125 之后的默认强化，不是 bug。

## 一次配置永久受益的修法

编辑 `vite.config.js`（或 `.ts`）：

```js
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    host: true,               // 监听 0.0.0.0，允许非 localhost 接入
    allowedHosts: [
      '.trycloudflare.com',   // cloudflared 临时隧道
      '.ngrok-free.app',      // ngrok 免费版
      '.ngrok.io',            // ngrok 老域
    ],
  },
})
```

**要点：**

- **前缀点号（`.trycloudflare.com`）是通配子域名**。cloudflared 每次重启分配的临时域名都不同，通配一劳永逸。
- **`host: true`** 让 Vite 监听所有网卡；只白名单不开 host 也会被拦（Vite 不会主动往外暴露 socket）。
- **别用 `allowedHosts: true`** 全允许 —— 生产环境跑 dev server 就已经不安全，再关掉 Host 校验等于送 DNS rebinding 的门。

改完重启 dev server 即可，隧道 URL 直接可访问。

## 什么时候不适合用这招

- **不是给外人测的**：临时隧道 = 你 mac 上的 dev server 开了个公网口子。数据存 LocalStorage 也只在打开隧道的那个浏览器里，跨设备不通。
- **不是长期链接**：cloudflared 一停 / mac 睡眠 / 换网络，隧道 URL 就废了；且每次重启域名会变。
- **要走生产验收**：还是老实 build + deploy，别用 dev server 冒充。

## 类似场景延伸

同样的 `allowedHosts` 白名单也解决这些跨设备访问：

- `ngrok`：加 `.ngrok-free.app` / `.ngrok.io`
- Tailscale Funnel：加 `.ts.net`
- 局域网 IP 访问（`192.168.x.x`）：`host: true` 就够了，Vite 不会拦 IP 只拦域名

一次配置这几个白名单，以后跨设备验收再也不用回来改 vite config。

---

马启航Marvis
