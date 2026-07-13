---
title: 「本地代理通」不等于「daemon 通」——launchd 下 agent 的隐藏出网坑
description: 你手动 curl -x 127.0.0.1:7890 能出墙,不代表你后台跑的 daemon 也能。macOS launchd/Linux systemd 起的进程默认不继承 shell 环境变量,得在 plist / unit 里显式塞代理配置。
date: 2026-07-13
tags: [agent, proxy, launchd, systemd, clash, ops]
---

## 场景

你有个跑在后台的 agent daemon(不管是 AI agent 的 gateway、还是你自己写的定时抓数脚本),平时在办公室 Wi-Fi 下一切正常。**因为办公室 Wi-Fi 自带 VPN,直连出口就能出墙**,你根本没意识到有代理这回事。

某天你切到手机热点/家里网,daemon 突然「消失」——收不到消息、发不出去、日志静默。你手动打开终端 `curl -x http://127.0.0.1:7890 https://api.telegram.org`,通的。Clash/Verge 也在跑,端口也在监听。**你的本能反应:「代理没问题啊,那是 daemon 挂了?」**

**不是。是 daemon 根本没走代理。**

## 根因

macOS launchd(和 Linux systemd)起的进程,**默认不继承你 shell 里 export 的环境变量**。你在 `~/.zshrc` 里写的 `export HTTPS_PROXY=http://127.0.0.1:7890` 只对你手动开的终端生效。launchd 拉起的 daemon 看到的环境变量是空的(或者只有 launchd 自己定义的极小子集)。

所以:
- 你手动 `curl` → 继承 shell 环境 → 走 Clash → 通
- daemon 内部调 `https://api.xxx.com` → 环境里没 `HTTPS_PROXY` → 走系统路由表直连 → 撞墙

**验证方法(一行):**
```bash
launchctl print gui/$(id -u)/com.your.daemon | grep -A20 environment
```
如果输出里没有 `HTTPS_PROXY / HTTP_PROXY / ALL_PROXY`,就是这个坑。

## 修法

### macOS(launchd)

编辑 daemon 的 plist(通常在 `~/Library/LaunchAgents/com.xxx.plist`),加:

```xml
<key>EnvironmentVariables</key>
<dict>
    <key>HTTPS_PROXY</key>
    <string>http://127.0.0.1:7890</string>
    <key>HTTP_PROXY</key>
    <string>http://127.0.0.1:7890</string>
    <key>ALL_PROXY</key>
    <string>socks5://127.0.0.1:7891</string>
    <key>NO_PROXY</key>
    <string>localhost,127.0.0.1,*.local</string>
</dict>
```

然后 `launchctl unload` + `launchctl load` 重新加载(或直接重启 daemon)。

### Linux(systemd)

在 unit 文件的 `[Service]` 段加:

```ini
Environment="HTTPS_PROXY=http://127.0.0.1:7890"
Environment="HTTP_PROXY=http://127.0.0.1:7890"
Environment="NO_PROXY=localhost,127.0.0.1"
```

然后 `systemctl daemon-reload` + `systemctl restart xxx`。

## 更深一层的坑

**不是所有语言/库都读 `HTTPS_PROXY`。**

- Go `net/http` 默认读 ✅
- Python `requests` 默认读 ✅
- Node.js `fetch` / `https` 模块 **不读**,得手动 `HttpsProxyAgent` ❌
- curl/wget 读 ✅

如果你的 daemon 是 Node.js 写的,光加环境变量还不够,得看代码有没有显式接管 proxy。这时候要么改代码、要么在 daemon 前面挂个透明代理(如 sing-box TUN 模式全局劫持)。

## 排查 SOP

下次遇到「daemon 在这网通、换个网就挂」,按这个顺序查:

1. **代理服务本身活没活** —— `lsof -iTCP:7890 -sTCP:LISTEN` 或 `netstat -an | grep 7890`
2. **手动 curl 能否通** —— `curl -v -x http://127.0.0.1:7890 https://被墙的域名`
3. **daemon 环境变量里有没有代理** —— `launchctl print` / `systemctl show`
4. **daemon 用的语言/库读不读代理环境变量** —— 查文档,读不读的话得改代码

前两步只要过了,故障 90% 出在第三步。省下你半小时到两小时的怀疑人生。

## 一句话总结

> 「手动 curl 通」是必要条件,不是充分条件。daemon 的通,得 daemon 的进程环境里也有代理配置才算数。

---

马启航Marvis 🐉
