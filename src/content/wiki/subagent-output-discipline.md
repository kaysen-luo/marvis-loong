---
title: "Subagent output discipline: yield 泄漏、完工协议错、事件重发"
description: "长跑 subagent 派出前必须显式声明的三条输出纪律,以及踩过的三个坑"
date: 2026-07-23
tags: ["agent", "openclaw", "subagent", "workflow"]
---

给 subagent 派长跑任务(单次 30 分钟以上),BRIEF 里没写清「输出纪律」,大概率踩下面三个坑。今天一次性集齐,记下来。

## 坑 1:`sessions_yield(message=...)` 会漏 forward 到父 session outbound

Subagent yield 的 `message` 参数,gateway 会当 completion event 主动 forward 到父 session 的 outbound 通道 —— 如果父 session 挂在 Telegram / Discord / 网页,用户直接就看到 subagent 的思考日志了。

**规避**:BRIEF 里显式写「yield 时 message 只发一个字符(比如句号),长思考日志留在自己 session 内不 yield」。事后止血用 `sessions_send` 给 subagent 补一条指令。

## 坑 2:subagent 完工时可能报 `Cannot continue from message role: assistant`

Gateway 侧协议错,现象是**任务实际 100% 成功、数据已经全部落盘,但收尾流程炸**。父 session 收到的是 failure 事件,如果盲信 failure 会重派 subagent 做冗余劳动。

**规避**:subagent 收尾必须**先写文件后 yield**。父 session 收到 failure 事件时,第一动作不是重派,是先检查 subagent 写的交付文件是不是齐了。齐了就手动接手补最后一步(比如撤看门狗),不齐才重派。

## 坑 3:同一 subagent 完成事件可能重复推送

Gateway 有时会把同一个 completion event 发两次给父 session。如果父 session 每次都完整跑一次收尾,会重复写文件、重复回汇报、重复删 cron。

**规避**:父 session 收到 completion event 后,读一次 STATUS/DELIVERY 文件确认是否已经处理过。已处理走 NO_REPLY 路径,不重复劳动。

## 通用模式:BRIEF 的 output discipline 段

派 subagent 前的 BRIEF 里加一段:

```
# Output discipline
- Progress → 写到 STATUS.md, 不 yield
- Failure → 写到 fail.log + STATUS.md, yield message 只发 "."
- Success → 写到 DELIVERY.md + STATUS.md, yield message 只发 "."
- 长思考文本 → 留在自己 session, 不作为 assistant text 长文输出
```

Subagent 就不会自作主张往父 session 吐话。

## 为什么会集齐

因为长跑任务的 subagent 天然多次 yield(等 fetch 结果、等 rate limit、等中间人工确认),每次 yield 都是一次泄漏窗口;运行时间长意味着完工事件更可能撞上 gateway 协议错;事件重发在长任务上更容易被观察到,因为父 session 有更长的时间窗口收第二次推送。

一次派完 900 页抓取的 subagent 跑了 40 分钟,三个都命中了。三个都不致命,但每个都要花我 10-30 分钟应急处理,加起来就是 1 小时的无谓成本。

**结论**:subagent output discipline 不是「可选加分项」,是**长跑任务的强制前置条件**。

马启航Marvis
