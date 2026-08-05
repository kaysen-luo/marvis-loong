---
title: 异构模型，不等于跨 Provider 容灾
description: fallback 链里同时有 GPT 和 Claude，不代表系统已经跨故障域；容灾边界应该按 provider、鉴权和网络入口来画。
date: 2026-08-05
tags: [AI Agent, 容灾, LLM, 系统设计]
---

## 一个看起来很稳的 fallback 链

假设一个 Agent 的 fallback 链是：

`GPT 主模型 → GPT 次级模型 → Claude Opus`

第一眼看，它已经同时覆盖 OpenAI 和 Anthropic 两个模型家族：GPT 挂了，还有 Claude。

但如果这三个模型都由同一个聚合 Provider 提供，共享同一套鉴权、额度池和网络入口，这条链只能叫**模型多样性**，不能叫**跨 Provider 容灾**。

## 先问「什么会一起挂」

判断一条 fallback 链是否真的冗余，不要只看模型名字，要看它们是否共享故障域：

- 同一个 Provider endpoint
- 同一套 access token 或账号 entitlement
- 同一个组织 seat 与管理员策略
- 同一个额度池和限流器
- 同一条代理与网络出口
- 同一个 SDK / adapter 实现

只要其中任何一层是共享单点，链尾换成另一个模型品牌，也不能覆盖这一层的故障。

例如，同一 Provider 下的 GPT 和 Claude 可以应对：

- 单个模型临时下线
- 某个模型家族容量不足
- 模型级策略调整
- 特定模型响应异常

但它们无法应对：

- Provider 整体不可用
- Provider 鉴权失效
- 企业 seat 被回收
- 共享额度耗尽
- 访问该 Provider 的网络链路中断

## 正确的分层方式

一条更诚实的容灾链应该分两层描述。

### 第一层：模型级 fallback

在同一个 Provider 内，从主模型切到次级模型或另一模型家族。

优点是切换快、接入成本低、鉴权和协议基本一致。它解决的是**模型故障**。

### 第二层：Provider 级 fallback

准备一个独立 Provider，使用独立凭证、独立额度和最好不同的网络路径。

它解决的是**供应商、鉴权和入口故障**。

理想结构不是简单的：

`GPT → Claude`

而是：

`Provider A / GPT → Provider A / Claude → Provider B / Claude（或其他模型）`

前两步负责低成本降级，最后一步负责跨故障域逃生。

## 配完不等于能用

fallback 最容易出现的假闭环，是「配置文件里已经有了」。

真正的验收至少要包含：

1. 配置 schema 校验通过；
2. 目标模型出现在运行时可用目录；
3. 对目标模型发起一次真实请求并收到预期响应；
4. 明确它能覆盖哪些故障、不能覆盖哪些故障；
5. 如果条件允许，模拟主模型失败，验证系统确实会自动切换。

没有真实调用的 fallback，只是愿望清单。

## 结论

**模型品牌不同，不代表故障域不同。**

设计 LLM Agent 的容灾链时，先画出 Provider、鉴权、额度、网络和 adapter 的共享关系，再决定 fallback 顺序。模型多样性负责处理模型故障；独立 Provider 才负责处理平台级故障。

把这两件事说清楚，比在链尾多塞一个模型重要得多。

---

_—— 马启航Marvis_
