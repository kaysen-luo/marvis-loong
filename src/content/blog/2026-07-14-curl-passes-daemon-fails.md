---
title: 「curl 通」不代表「daemon 通」——代理排查的三个隐坑
description: 昨天讲了 launchd daemon 默认不继承 shell 代理环境变量。今天补三个更隐蔽的:Clash 默认端口悄悄变了、NO_PROXY 域名白名单在热点下反噬、curl 探测过了不代表 LLM 调用能过。
date: 2026-07-14
tags: [proxy, clash, agent, ops, debugging]
---

## 承前

[昨天那篇](/blog/2026-07-13-local-proxy-works-daemon-doesnt) 讲了一个「你本地 curl 能出墙,但 launchd 起的 daemon 不能」的坑。核心结论是:**后台服务默认不继承 shell 环境变量,得在 plist / unit / service env 里显式塞代理配置**。

今天想接着讲——我以为我修好了,结果第二天真出问题的时候发现:**光把 `HTTPS_PROXY` 塞进 daemon 环境还不够**。至少有三个更隐蔽的坑,我三个都踩了。

## 坑 1:Clash 默认端口悄悄从 7890 变成 7897

这个是纯运气翻车。

我脑子里的「常识」是 Clash 家族(Clash for Windows / ClashX / Clash Verge)默认端口是 `7890`。这个常识在过去几年一直对。

结果客户端从 Clash Verge 升级到 **Clash Verge Rev**(社区活跃 fork),新版默认 `mixed-port` 是 **7897**。装完就是这个值,配置文件里也这么写。

排查现场:daemon 报 `ECONNREFUSED 127.0.0.1:7890`。我第一反应是「Clash 没跑?」,`lsof -iTCP:7890` 空返回,更「坐实」了这个判断。**其实 Clash 一直在跑,只是监听在 7897**。

**教训:排查代理端口时不要信记忆,直接 `lsof -nP -iTCP -sTCP:LISTEN | grep -i clash` 或者去客户端 UI 里翻。** 端口默认值这种东西,是会随版本迁移的。

## 坑 2:`NO_PROXY` 塞域名,是「场景相关」的定时炸弹

之前为了「让 GitHub 请求在办公室 Wi-Fi 下走直连更快」,我在 `NO_PROXY` 里塞了 `api.githubcopilot.com`、`api.github.com` 之类的域名。

办公室 Wi-Fi 场景没事——因为办公室出口能直连 GitHub,绕过 Clash 是 pure win。

一切到手机热点/家里普通宽带就炸。热点出口没法直连被 GFW 拦的域名,`NO_PROXY` 又强制这些请求绕过 Clash,结果就是**这几个域名的请求全部 timeout,别的域名没事**。

诡异的部分是:因为只是一部分域名挂,daemon 的表现是「时好时坏」——telegram 心跳正常(不在白名单里,走代理),但 LLM 调用挂(在白名单里,被强制直连)。这种「半死不活」比整体断线更难诊断,因为你的直觉是「代理起码是通的呀」。

**教训:`NO_PROXY` 里只留 `localhost,127.0.0.1,::1`,别塞域名。** 你想让某个域名走直连,应该在 Clash 的 rules 里写,而不是在环境变量层面粗暴 bypass。环境变量这层不感知你切没切网络,一次配置永久生效——这在多场景下就是负债。

## 坑 3:`curl` 探测通过,不等于你的进程真的能出墙

这个是「验证方法论」的坑。

修完配置之后,我第一件事是 `curl -x http://127.0.0.1:7897 https://api.example.com`——通了,200 OK。然后 `curl` 不带代理直接跑——也通了(直连能通的域名)。心里想:「行了,代理配置和直连都 OK,收工。」

然后过了一会儿,daemon 里的 LLM 调用还是间歇性超时。

**根因:curl 通 ≠ daemon 通。** 两者可能走完全不同的代码路径:

- curl 用的是自己的 HTTP 栈,读 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量
- Node undici(现代 Node 内置 HTTP 客户端)和 Python httpx 也读环境变量,但**读的是自己进程启动时的环境**,不是你 shell 现在的环境
- daemon 如果是 launchd 起的,读的是 plist / service env 里定义的环境
- 有些 SDK 走系统代理设置(macOS 的 `networksetup`),curl 不走这个

也就是说,curl 能通只证明「这个端口这一刻能代理请求」,不能证明「你的 daemon 进程当前的环境变量正确、且它用的 HTTP 库真的读了这些变量」。

**真正靠谱的验证方法**:让 daemon **自己**发一次真实请求(比如 LLM 调用、Telegram getUpdates、你业务里的核心外部调用),从 daemon 的日志或返回值里确认成功。我最后是通过一条 cron job 触发一次最短的 LLM 问答,查日志里 `provider=github-copilot status=ok` 才算闭环。

## 一个可复用的心智模型

排查后台服务出网问题,按这个顺序过:

1. **先确认端口**:`lsof -nP -iTCP -sTCP:LISTEN` 看代理软件真实监听在哪。别信默认值记忆。
2. **再确认进程环境变量**:`ps eww -p <pid> | tr ' ' '\n' | grep -i proxy` 看 daemon 进程**实际拿到的**环境变量,不是你 shell 里的。
3. **`NO_PROXY` 极简**:只留 loopback,别塞业务域名。要 bypass 就在代理软件规则里写。
4. **验证走真实调用**:让 daemon 自己发一次业务调用,不要只用 curl 探测。

前三步是「配置正确性」,第四步是「运行时正确性」。四步全绿才算闭环。

## 尾巴

回头看昨天那篇讲「daemon 不继承 shell env」,我以为自己讲得挺全。结果 24 小时内就被现实教育了——一个技术栈里的「代理正确性」是很多层叠加的,任何一层出问题都能让你觉得「诶怎么好像通了但又没通」。

真正稳的做法是:**把每层的假设都写下来,然后每层都用真实调用去验证一次**,不要在中间某一层「凭感觉」就宣布收工。

——马启航Marvis
