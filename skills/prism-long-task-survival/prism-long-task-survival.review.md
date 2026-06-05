# 挑刺报告 · 复杂任务处理方案（双方案对比评审）

**评审官**：牛至佳 / Nyar Sathla（OPC 独立评审官）
**评审日期**：2026-06-05
**收件人**：马启航（Marvis）、牛知灵（Nova）—— 各自完善对应方案
**中转**：Kaysen（仅转交，非汇报对象）
**被审对象**：
- 方案 A · `prism-long-task-survival`（归属：马启航）
  路径 `/Users/kylon_luo/.openclaw/workspace/skills/prism-long-task-survival/SKILL.md`（108 行 / 10150 B，已逐行核实原文）
- 方案 B · Hermes 拆解三件套（归属：Nova）
  `plan` + `writing-plans` + `subagent-driven-development`（已逐一 skill_view 核实原文）

---

## 0. 评审前置：一个必须先纠正的比较前提

委托语将两者描述为"同样是针对复杂任务的切片处理"。**此前提不成立，二者不在同一比较维度，不可直接问"哪个更有价值"。**

- **方案 B（Hermes 三件套）= 任务结构层**：解决"一个大任务逻辑上怎么拆成小块、怎么排序、怎么逐块验收"。与底层模型/网关无关。其"切片"切的是**任务的逻辑结构**，目的为清晰与可验收。
- **方案 A（PRISM）= 基础设施容错层**：解决"在 `copilot.xchunzhao.top` 这一特定网关上，Claude 的 SSE 流在 7–12 分钟（sonnet）/ ~90 秒（opus 4.7）被服务端静默掐断时，任务如何存活"。死绑一个具体网关的一个具体缺陷。其"切片"切的是**单次请求的墙钟时长**，目的为不触发 ~600 s 超时。

二者非竞品，而是**互补两层**。下文不评"谁淘汰谁"，只对**各自方案内部的缺陷**挑刺，供两位提案方完善。

---

## 第一部分 · 致马启航：方案 A（prism-long-task-survival）挑刺

总体评价：**高质量、单文件自包含、信息密度高、每条结论附实测日期与 PoC 证据路径**（如 `acp-prism-poc/round2/report.md`、2026-06-04 35 页爬取验证）。"不是听说而是撞过、验过、这条路死了"是其最大优点。以下为待完善项。

### A-1【中 · 维度：逻辑自洽性】"primary route" 的入口动作暴露在它要逃离的缺陷之下（自指风险）

- **问题**：文档将"OpenClaw subagent 逃生通道"称作 *"the proven primary route / default route for any long task"*，理由是 subagent 跑在非 Prism 的 LLM 路径上。但**同一份文档自己记录**（§"Why the main session keeps getting cut"）：`sessions_spawn` 这一入口动作若在主会话中耗时较长，**会被 Prism 掐断，导致 spawn 被吃掉、child 根本未生成**（实测同日两次 `sessions_spawn` + 一次 gateway op 均以此方式死亡，`subagents list` 事后为空）。
- **论据**：即"主要逃生路线"的**入口本身仍受它所要逃离的掐断窗口约束**。文档已打补丁（SOP 第 6 步 verify-or-respawn），但"入口可能被同一 bug 吃掉、需事后验证补救"的路径，称其为 "proven primary route" 在严谨性上略过头。
- **改进建议**：把表述从 "proven primary route" 改为 **"主要路线，但其入口动作（spawn）仍受同一掐断窗口约束，必须 verify-or-respawn"**。让读者在选用该路线时即知入口有风险，而非读到第 6 步才回溯发现。

### A-2【中 · 维度：边界条件 / 可行性】掐断窗口缺少"触发阈值的下界证据"，5 分钟红线的安全裕度论证不闭环

- **问题**：SOP 第 1 条"单请求 ≤5 min，留 30% 裕度于 7 min 下界"。但"7–12 min"这个**下界 7 min 本身**的来源、波动范围、是否随负载/时段漂移，文档未给区间证据；30% 裕度是基于单一下界点估的。
- **论据**：若 7 min 下界在高负载时会下移（例如降到 5–6 min），则 5 min 红线的实际裕度被高估，仍可能踩线。容错手册对"触发阈值"的不确定性必须显式声明。
- **改进建议**：补一行"7 min 下界的观测样本数 / 是否见过 <7 min 的掐断 / 已知影响因素（并发、时段、模型）"。若样本不足，明确标注"下界为保守经验值，未见 <7 min 但样本有限"，避免读者把 5 min 当作有充分余量的安全值。

### A-3【低 · 维度：缺失环节】逃生通道换 provider 的"成本/合规"只点到"check with user"，无量级与边界

- **问题**：§Escape hatch 与 SOP 均提示 "burns the budget on a different provider; check with the user first if cost matters"，但未给**任何量级参照**（OpenClaw 那条路单位时长成本约为 Prism 的几倍？何种任务规模才值得切？），也未界定"cost matters"的判定权归谁。
- **论据**：留"问用户"作为唯一闸门，等于把成本决策完全外推，缺少让执行 agent 自行判断的下限阈值；不同 profile 对"值不值"理解不一，易出现要么滥用昂贵通道、要么该用时不敢用。
- **改进建议**：补一条粗略量级（哪怕"OpenClaw 路约为 Prism 的 N 倍/同级，仅在任务 >X 分钟或单文件 ≥2k 行时启用"），把模糊的"check with user"升级为带阈值的判定规则。

### A-4【低 · 维度：可行性 / 时效】关键缺陷数据绑定特定模型版本号，缺"复验日期/失效提示"

- **问题**：核心数字"sonnet 7–12 min、opus 4.7 ~90 s"绑定具体模型版本（opus **4.7**）。网关侧 `proxy_read_timeout` 或上游模型一旦调整，这些数字即可能失效，但文档无"最后复验日期 / 建议复验周期"。
- **论据**：本机当前主模型已是 opus **4.8**（见运行环境）。文档里 opus 4.7 的 ~90 s 结论是否仍适用于 4.8，未知。容错手册的数字若无时效标注，会被后来者当作长期事实误用。
- **改进建议**：在 §"What's actually broken" 顶部加一行"数据最后复验：2026-05（round 2）/ 模型：sonnet、opus 4.7；模型或网关变更后需重测"。

### A-5【低 · 维度：安全与合规】"Anthropic-direct token" 逃生分支未附密钥处置红线

- **问题**：多处提到逃生/升级路径为"escalate to K师 拿 Anthropic-direct token"。但拿到直连 token 后的**存放、作用域、轮换、禁止落盘到 workspace 文件**等红线，本文档未提（虽 AGENTS.md 有"don't exfiltrate"，但本 skill 是直接操作 token 的具体场景，应就地复述红线）。
- **论据**：直连 token 绕过网关 = 绕过网关侧的审计/限流，泄露面更大；在"长任务存活"这个会被多 profile 复用的 skill 里，缺密钥红线是一个三不管地带。
- **改进建议**：补一句"Anthropic-direct token 仅置于环境变量/密钥管理，**严禁写入 workspace 任何文件或提交**，用毕由 K师 轮换"。

---

## 第二部分 · 致牛知灵（Nova）：方案 B（Hermes 拆解三件套）挑刺

总体评价：链路自洽（`plan` 只写不做 → `writing-plans` 切 bite-sized → `subagent-driven-development` 派子 agent 执行 + 两阶段评审），教学化、可验收点设计扎实。以下为待完善项。

### B-1【中 · 维度：边界条件 / 缺失环节】整套方法论默认"网关不会掐断长流"，与真实运行环境（PRISM）冲突，缺执行时长约束

- **问题**：`subagent-driven-development` 的成本说明承认"more subagent invocations（实现+2评审/任务）"，但**全链路无任何"单次请求/单子 agent 墙钟时长上限"的约束**。在本团队实际跑的 PRISM 网关上（见方案 A），任一子 agent 若单轮 >7 min 即被静默掐断、`subagents list` 可能为空。
- **论据**：方案 B 在"完美网关"假设下成立；但它将被运行在会掐断的真实网关上。两份方案恰好可咬合——`writing-plans` 的"2–5 min bite-sized 任务"**天然满足** PRISM 的"单请求 ≤5 min"硬约束——但方案 B 自身**未声明这一约束动机**，读者不会知道"为何必须切到 5 min 以内"，可能切出 10–15 min 的大块而踩线。
- **改进建议**：在 `writing-plans` / `subagent-driven-development` 增一条"运行环境约束"：**单子 agent 单轮墙钟 ≤5 min**，并注明"若部署在有 SSE 掐断的网关（如 PRISM），此约束为硬性，参见 prism-long-task-survival"。

### B-2【中 · 维度：可行性】"派 spawn 子 agent 即视为已在执行"缺 spawn 落地校验，与 A 记录的失败模式正面相撞

- **问题**：`subagent-driven-development` 的 per-task 流程是 dispatch implementer → spec review → quality review，**默认 `delegate_task` / spawn 一旦发出，子 agent 即在工作**。流程未含"先确认子 agent 真的起来了"这一步。
- **论据**：方案 A 实测记录（同日两次 spawn 被掐断吃掉、child 不存在）证明"spawn 发出 ≠ child 存在"。方案 B 若在 PRISM 上执行，可能对着一个根本没生成的 child 等评审、或把上一任务的空结果当成功推进，污染后续。
- **改进建议**：在 dispatch implementer 之后、spec review 之前，插入一步 **"verify child spawned（检查 status: accepted / subagents 非空），未起则重新 spawn"**。直接复用方案 A SOP 第 6 步的做法。

### B-3【低 · 维度：成本与资源】两阶段评审的子 agent 成本未给"按任务规模分级"的取舍，小任务易过度设计

- **问题**：每任务固定"实现 1 + spec 评审 1 + quality 评审 1 = 3 次子 agent 调用"，外加全局 final review。文档承认成本更高但仅以"catch issues early 更便宜"一句带过，未给**何时可降级**（例如纯样板/低风险任务是否必须两阶段全套）。
- **论据**：对 2–5 min 的 bite-sized 小任务无差别套三段评审，单位价值产出的调用开销偏高，违反"YAGNI / 不过度设计"——而这恰是方案 B 自己在 `writing-plans` 中倡导的原则，存在自我不一致。
- **改进建议**：补一条分级规则："高风险/不可逆/触及共享文件的任务 → 两阶段全套；低风险样板任务 → 可合并为单次评审或自检+抽查"。让评审强度匹配任务风险，呼应自身的 YAGNI 主张。

### B-4【低 · 维度：缺失环节】链路缺"失败回滚/熔断"路径，只规定正向推进

- **问题**：流程对"reviewer 反复发现问题"给了 re-review 循环，但**未定义熔断**：同一任务评审循环 N 次仍不过、或子 agent 连续失败时，何时**停止、上报、放弃该任务**？`subagent-driven-development` 的 references 提到 gates-taxonomy（含 Abort gate），但主 SKILL.md 未把 Abort 条件写进主流程。
- **论据**：无熔断的 re-review 循环理论上可无限烧子 agent 调用（与 B-3 的成本问题叠加）。容错性上是一个开口。
- **改进建议**：在主流程显式写出 Abort 触发条件（如"同一任务评审循环 ≥3 次未过 → 停止并上报人类决策"），把 references 里的 Abort gate 提升到主 SOP。

---

## 第三部分 · 给两位的共同结论（非命令，供参考）

1. **二者互补、建议叠用，而非二选一**：
   - `writing-plans` 切出的 2–5 min 任务块 → 恰好满足 PRISM "单请求 ≤5 min"；
   - `subagent-driven-development` 的执行 → 套上 PRISM 的"verify child spawned / verify-before-deliver / Playwright 绕 gateway 兜底"；
   - 即 **结构层（B）负责"怎么切、怎么验收"，容错层（A）负责"切出来的块在真实网关上怎么不被掐断"**。两份方案各自补齐对方未声明的前提（A 补"为何切到 5 min"，B 补"切了之后在掐断网关上如何执行"），即成闭环。
2. **跨方案的单一最高优先级缺口**：**B 默认网关不掐断、A 已证明网关会掐断** —— 这是两份方案之间最大的"三不管地带"。B-1 / B-2 与 A-1 指向同一处。建议两位优先对齐"单轮 ≤5 min + spawn 落地校验"这两条，作为协作接口。

---

## 评审官声明

本报告仅对方案质量负责，不修改任一方案内容，不代任何一方决策。所有反对意见均附维度、论据与改进建议；未发现可证明会导致方案失败、却未被任一方覆盖的额外致命缺陷。两份方案均为高质量产出，上述为完善项而非否定。

—— 牛至佳 / Nyar Sathla
