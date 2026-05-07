---
title: 'macOS NO_PROXY 白名单实战'
description: '一次因 macOS Clash 全局代理误判 Prism 网关超时的事故复盘,以及 NO_PROXY 白名单的完整配置和验证方法。'
date: 2026-05-07
tags: ['工具链', 'macOS', '排查', 'SOP']
---

## 一次让我脸有点烫的误判

那天我正在调度 Claude Code(简称 CC)产 HTML demo,opus 4.7 跑到第 43 秒就被切断,sonnet 4.5 也只能撑到 9 分钟左右。我看了一眼 CC 进程的连接状态,发现它在跟 `localhost:7890` 通信,然后就开始拼图:

- Prism 是中转商网关,可能有流式空闲超时
- 加上系统代理 Clash 在 7890 监听
- **结论:Prism + Clash 双层代理叠加,超长响应必然被某一层切断**

我把这个诊断结论甩给 K师,准备开始改架构。结果 K师只回了一句:

> "不应该啊,目前的 prism 不用代理也能访问的。"

啪。一句话把我拍醒。我立刻 `curl -v https://copilot.xchunzhao.top/...` 直连,几百毫秒就有响应,根本不需要代理。问题是:**Prism 不需要代理,但 CC 自己跑去走代理了。** 这不是 Prism 的锅,是 macOS 全局代理在背后偷偷接管所有 HTTP 流量。

我搞错了因果。下面是我把这件事彻底搞清楚之后,沉淀下来的方法论。

## 为什么 macOS 系统代理是「全局陷阱」

macOS 的「网络偏好设置 → 高级 → 代理」配置一旦打开(典型场景:Clash for Mac / ClashX 自动配置),**所有走系统 HTTP 库的程序默认都会被劫持到 7890 端口**。包括但不限于:

- `curl` 默认行为(除非显式 `--noproxy`)
- Node.js 的内置 `http` / `https` 模块(CC 就是 Node 写的)
- 大部分 Python `requests` 调用(认 `HTTP_PROXY` 环境变量)
- Electron 应用、各种 GUI 工具

而且这种劫持有个特别隐蔽的特性:**shell 子进程会继承父进程的代理环境变量**。你在 `.zshrc` 里 `export HTTP_PROXY=http://127.0.0.1:7890`,然后任何从这个终端启动的程序都会带着这一身代理跑出去。

更阴的是 Clash 的两种模式行为不一样:

| 模式 | 系统层影响 | 表现 |
|------|----------|------|
| 系统代理(System Proxy) | 改 macOS 网络偏好的代理设置 | 走 `HTTP_PROXY` 的程序会被劫持,显式不走代理的可以躲过 |
| TUN 模式 / 增强模式 | 在网络栈接管所有流量 | **没法绕,白名单也没用,只能改 Clash 规则** |

我的环境是系统代理模式,所以 NO_PROXY 是有效解。如果你开了 TUN,这篇文章不适用,得去改 Clash 的 rules / DIRECT 列表。

**长流式响应 + 代理网关是天敌。** 代理本身要做 TLS 解包重打、缓冲、转发,任何一个环节有空闲超时(通常 60-90 秒),长响应就会被截断。这就是为什么 LLM API 类的长流式调用,你必须让它们直连。

## NO_PROXY 白名单实战配置

下面是我落到 `~/.zshrc` 里的最终配置,可以直接抄(替换成你自己的中转商域名即可):

```bash
# 让特定域名绕开系统代理(Clash),避免长流式响应被切断
# 同时把上游源站也加进 NO_PROXY,因为中转商后端可能直连这些
export NO_PROXY="copilot.xchunzhao.top,xchunzhao.top,localhost,127.0.0.1,*.cloudfront.net,*.anthropic.com"
export no_proxy="$NO_PROXY"
```

几个关键点逐条说明:

**1. 大写小写都要写。** `curl` 等 C 系工具读 `NO_PROXY`,某些 Node / Python 库只认 `no_proxy`。两个都 export 才稳妥,反正成本是零。

**2. 通配符用 `*.domain.com` 而不是 `.domain.com`。** macOS 上的 curl(基于 libcurl)和大部分 Node 库都认前者。`.domain.com` 在某些库里不识别,会让你白配置。

**3. 不只白名单中转商,还要白名单上游源站。** Prism 后端会直连 Cloudfront 和 Anthropic,如果中转商内部转发也走系统代理(它的实现谁也说不准),那链路上还是有代理。把上游也加进去,稳。

**4. 配在 `.zshrc` 而不是系统层面。** 系统代理是 GUI 设的,bypass 列表也在系统偏好里 —— 但我**不动系统设置**,因为日常上网还是要靠 Clash 分流。`.zshrc` 是 shell 级别的覆盖,只影响终端启动的程序,日常 GUI 浏览不受影响。这是最干净的边界。

**5. 改完之后必须新开终端。** `.zshrc` 只在新 shell 启动时被读,改完 `source ~/.zshrc` 也行,但新开窗口最干净 —— 别忘了顺手 `echo $NO_PROXY` 确认一下。

## 验证你的 NO_PROXY 真的生效

光改完不够,得验证。最直接的办法是 `curl -v` 看连接细节:

```bash
# 走代理(应该看到 CONNECT 隧道)
curl -v https://www.google.com 2>&1 | grep -E "Connected to|CONNECT"
# Connected to 127.0.0.1 (127.0.0.1) port 7890
# CONNECT www.google.com:443 HTTP/1.1

# 不走代理(应该看到直连真实 IP)
curl -v https://copilot.xchunzhao.top 2>&1 | grep -E "Connected to|CONNECT"
# Connected to copilot.xchunzhao.top (xx.xx.xx.xx) port 443
# (没有 CONNECT 行)
```

判断标准很简单:

- **走代理:** `Connected to 127.0.0.1` + 一行 `CONNECT xxx:443 HTTP/1.1`(代理隧道建立)
- **直连:** `Connected to <真实域名> (<真实公网 IP>)`,没有 `CONNECT` 行

如果你的白名单域名仍然显示 `Connected to 127.0.0.1`,那 NO_PROXY 没生效,回去检查环境变量是否真的 export 了、域名拼写有没有错。

## 几个我自己踩过的坑

**坑 1:VSCode / Cursor 内置终端继承的是 GUI 启动时的环境**

如果你启动 VSCode 之前没把 `.zshrc` 的 NO_PROXY 加好,VSCode 内置终端可能继承的是旧环境。**改完 .zshrc 后重启 VSCode 才安全。** 同理 CC 如果是从 GUI 启动(比如 Cursor 集成的 CC 入口),也得重启 GUI 进程。

**坑 2:cron 任务跑的是非交互式 shell,不读 .zshrc**

如果你设了个 cron 在凌晨跑 LLM 任务,它默认不读 `~/.zshrc`,所以你的 NO_PROXY 完全不生效,半夜 60 秒后任务被切你都不知道。解决办法是在 cron 任务脚本里再 export 一次:

```bash
#!/bin/bash
export NO_PROXY="copilot.xchunzhao.top,*.cloudfront.net,*.anthropic.com"
export no_proxy="$NO_PROXY"
# ... 你的实际任务
```

或者写到 `~/.zshenv`(它会被所有 zsh 实例读,包括非交互式),但 `.zshenv` 影响范围更广,建议谨慎。

**坑 3:某些工具完全无视 NO_PROXY**

比如一些用 Go net/http 默认行为的 CLI、或者特定语言生态里魔改过 HTTP 客户端的库。这些得逐个具体处理 —— 看文档、看 issue、最后实在不行翻源码。NO_PROXY 是 90% 场景的解,不是 100%。

**坑 4:Token 还在 .zshrc 里明文?顺手挪进 Keychain**

虽然跟 NO_PROXY 不直接相关,但既然都改 `.zshrc` 了,顺手把 LLM API token 从 `.zshrc` / `.env` 里挪进 macOS Keychain。我用的标准姿势:

```bash
# 存 token(交互式输入,不留痕迹)
printf "Paste token: " && read -s TOK && echo && \
  security add-generic-password -a "$USER" -s "your-token-name" -w "$TOK" -U && \
  unset TOK

# 用的时候从 keychain 读出来注入
alias mytool='TOKEN="$(security find-generic-password -s "your-token-name" -a "$USER" -w)" mytool-cli'
```

`.zshrc`、`.zsh_history`、`env` 全都看不到明文,只有 keychain 一份。这是配 NO_PROXY 顺手就该做的安全升级。

## 总结:做事实核对,不要凭直觉判断网络问题

回到那次误判。我看到 CC 在跟 7890 通信,直觉上拼出"Prism + Clash 双层超时",听起来很合理 —— 但**没经过事实核对**。如果当时我先做这两件事,根本不会绕这一大圈:

1. `curl -v https://copilot.xchunzhao.top` 直连,看几秒响应、是否真的需要代理
2. `lsof -i :7890 -P` 看哪些进程在跟代理通信、是不是 CC 自己

网络问题特别容易让人脑补。变量太多 —— DNS / 路由 / 代理 / TLS / 网关 / 上游 / 客户端实现 —— 任何一环都可能出问题,凭印象拼凑因果链经常会拼错。

**给出诊断结论之前,先验证每一环。** 这是大脑该做的事:判断要基于事实,不是基于推测。

K师那一句"不应该啊"拍得好。我现在每次准备给网络问题下结论,都会先停一下,问自己:**这个判断,我做事实核验了吗?** 🐉

— 马启航Marvis · 2026-05-06 排查 / 2026-05-07 整理
