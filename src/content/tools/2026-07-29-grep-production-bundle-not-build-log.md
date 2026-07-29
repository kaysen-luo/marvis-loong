---
title: "验产物别信构建日志——只 grep 线上 bundle"
description: "构建日志说「跑完了」和产物「跑对了」是两码事。上线验收唯一可信的证据是从线上 bundle 里 grep 出目标字符串。"
date: 2026-07-29
tags: ["工程", "部署", "调试", "SOP"]
---

## 场景

上线一个 SPA（React / Vue / Vanilla + Vite）。改了三个补丁，`pnpm build` 报「is patched」，CI 全绿，CDN 也部署完了。

**问题**：三个补丁真的进了线上产物吗？

## 大部分人的验证方式

1. 看构建日志有没有「built in Xs」的绿色成功
2. 看 CDN 部署面板显示 "Success"
3. 首页能打开就算过

**这三条全都不算数**。它们证明的是「构建器跑完了 + 文件上传了 + 首页 200」，不是「补丁的代码进了生产 bundle」。

我在最近一次 v1.0 上线时验产的动作是这样：

## SOP · 三步 grep 线上产物

### 1. 从首页 HTML 拿到当前生效的 bundle 哈希

```bash
U=https://your-site.pages.dev
curl -s $U/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1
curl -s $U/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.css' | head -1
```

Vite / Rollup 打包出来的产物都带内容哈希（`index-DyvOzQ1P.js` 这种）。首页 HTML 的 `<script src>` / `<link href>` 引用的哈希，才是**当前用户真正加载的那份**。CI 目录里的哈希、你本地 dist 里的哈希都不作数。

### 2. 拉下来直接 grep 目标关键字

```bash
curl -s $U/assets/index-DyvOzQ1P.js > /tmp/prod.js
grep -c 'gender' /tmp/prod.js          # 期望 ≥ 1，实际 3
grep -c 'canDeleteFragment' /tmp/prod.js  # 期望 ≥ 1，实际 1
```

**关键选字诀**：不要 grep 变量名（会被 minify 成 `a`/`b`），要 grep：
- 字符串字面量（`'gender'`、`"未命名"`）
- 保留的 CSS 类名（`right-floater`、`preview-title`）
- API 路径 / 事件名 / 特殊符号
- 属性 key（对象字面量 minify 后 key 保留）

### 3. CSS 单独验，用完整选择器 + 属性

```bash
grep -o '\.right-floater{[^}]*}' /tmp/prod.css
# .right-floater{...top:16px;flex-direction:row}
grep -o 'right-collapsed \.fab{[^}]*}' /tmp/prod.css
# right-collapsed .fab{right:20px}
```

CSS 不会被激进 minify，选择器 + 关键属性一起 grep 出来才有底气说「样式改动进了产物」。

## 为什么这套动作值得成为默认动作

### 「构建成功 ≠ 补丁生效」的三种翻车路径

1. **补丁改在了未被引用的分支/文件**：改完 `foo.js`，但 `main.ts` 引的其实是 `foo.legacy.js`。构建照样成功，产物里没你的改动。
2. **HMR 假象**：本地 dev 服务器热更新过了，本地看着对。生产 build 走的是完全另一条链路，配置差异让改动被 tree-shake 掉。
3. **CDN 缓存**：文件上传成功，但边缘节点缓存旧版本 6 小时。首页 200 里的 script 引用的还是旧哈希。

### 「实测证伪」是唯一的收口

我给自己定的铁律：**任何定性结论（「上线了」/「修好了」/「补丁生效」）出口前必须先实测证伪**。构建日志、CI 绿、部署面板这些都是「间接信号」，跟真相之间至少隔了三层假设。`curl -I` + `grep 产物` 是零假设的直接证据。

这条铁律用在别的地方也一样：
- 验安全头：`curl -I` 看响应头，不看 `_headers` 文件
- 验路由：`curl /some/deep/path` 看 200/404，不看 config
- 验 API 通不通：跑一次真调用查日志，不看健康检查 endpoint

## 反直觉的部分

「这不是很啰嗦吗？改一行都要 curl grep 一遍？」

不。这套动作花的时间：**3 条 curl + 3 条 grep ≈ 30 秒**。跟事后「用户报了个 bug，回滚构建二分排查」比起来便宜太多。

真正贵的是心智负担从「我记着某个补丁没验」搬到「产物里 grep 出来了」——后者不用记，前者会不知不觉塞满脑子，然后在最忙的时候漏掉。

## 一句话总结

**构建日志说「跑完了」，产物 grep 说「跑对了」。上线只信后者。**

—— 马启航Marvis
