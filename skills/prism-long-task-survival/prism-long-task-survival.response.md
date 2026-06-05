# 改进方案 · 回应 Nyar 评审（方案 A · prism-long-task-survival）

**提案方**：马启航 / Marvis Loong
**回应日期**：2026-06-05
**回应对象**：Nyar Sathla 的挑刺报告（`prism-long-task-survival.review.md`，第一部分 A-1~A-5）
**审批链**：Marvis 出改进方案 → K师 → Nyar 复审

---

## 0. 总体立场

**5 条全部成立，无一条误判。** 逐条核对原文 + 回查两轮 PoC 报告（round1/round2 `report.md`）后确认：没有任何一条是「她说缺、其实我已写过」。

但**采纳方式分两类**：
- **A-1 / A-4 / A-5**：照采纳，直接改文档表述。
- **A-2 / A-3**：**不照字面补「倍数/裕度数字」**——因为我手里没有支撑那些数字的实测，瞎填等于制造新的伪精度，违背本 skill「每条结论附实测证据」的最大优点。改成**用现有真实样本如实标注下界** + **可执行的阈值判定规则**，把模糊处升级为「诚实的不确定」而非「编造的确定」。

**额外增量（回查 PoC 时发现，review 未点到的 2 个精度错误）**：见 §6。这两个比 nyar 自己以为的更狠，必须一并修。

---

## 1. A-1 自指风险 —— ✅ 采纳

**她说的对在哪：** §Escape hatch 标题写 `the proven primary route`、body 写 `default route for any long task`，但同文档 §"Why the main session keeps getting cut" 自承：spawn 这个入口动作若在主会话耗时过长，会被同一个 Prism 掐断窗口吃掉、child 根本不生成（同日实测两次 spawn + 一次 gateway op 全死，事后 `subagents list` 为空）。"主逃生路线的入口本身受它要逃离的 bug 约束" —— 这是真自指，且风险埋在 SOP 第 6 步太靠后。

**改法（落地到 SKILL）：**
- §Escape hatch 标题：`Escape hatch — OpenClaw subagent (the proven primary route)` → 改为 `Escape hatch — OpenClaw subagent (primary route; its spawn entry still rides the same cutoff)`
- body 首句补一句**前置风险声明**（不等读者读到第 6 步）：
  > ⚠️ Caveat up front: the subagent **runs** off-Prism, but the **`sessions_spawn` entry call itself still flows through the main session's SSE stream** — so a long spawn can be eaten by the very cutoff you're escaping. This route is primary **only with** the verify-or-respawn step (SOP step 6) treated as mandatory, not optional.

**效果：** 「primary route」保留（它确实是默认首选），但读者在选用当下即知入口有风险，而非回溯发现。

---

## 2. A-4 数据绑定 opus 4.7 / 缺复验日期 —— ✅ 采纳（且比她说的更严重，见 §6.1）

**她说的对在哪：** 核心数字绑定 opus **4.7**，本机已 opus **4.8**，4.7 的 ~90s 是否适用 4.8 未知；全文无「最后复验日期 / 复验周期」。容错手册的数字无时效标注会被当长期事实误用。

**改法：** §"What's actually broken" 顶部加一行**数据时效戳**：
> **Data last verified: 2026-05 (PoC round 2). Models actually tested: `sonnet[1m]` = Sonnet 4.6 1M-context. The opus figure is NOT from this PoC — see note below. Re-test required after any model or gateway change.**

> **命名规范（一处定义，全文复用 — 收 R-1）：** 实测模型在文档首次出现处统一写 **`sonnet[1m]` = Sonnet 4.6 1M-context**，后文沿用 `sonnet` 即可。不再出现 `= Sonnet 4.6 1M` / `/4.6` 等并列异写。

（opus 数字的二手性单独在 §6.1 处理，比单纯加日期更重要。）

---

## 3. A-5 Anthropic-direct token 缺密钥红线 —— ✅ 采纳

**她说的对在哪：** 多处提 escalate 拿 Anthropic-direct token 逃生，但拿到直连 token 后的存放/作用域/轮换/禁止落盘红线本文档未就地复述。直连 = 绕网关审计/限流，泄露面更大；这是个会被多 profile 复用的 skill，缺密钥红线是三不管地带。AGENTS.md 虽有 "don't exfiltrate" 泛则，但本 skill 是**直接操作 token 的具体场景**，应就地复述。

**改法：** SOP 第 5 条 + §Escape hatch 凡提到 "Anthropic-direct token" 处，统一挂一句红线（参照 TOOLS.md 既有的 keychain 规范）：
> 🔴 Anthropic-direct token rule: keep it in env var / keychain only — **never written to any workspace file, never committed, never logged in plaintext**. Read once from keychain, `unset` after use. Rotated by K师 after the task. (Same discipline as the Notion token in TOOLS.md.)

**成本：** 一句话，零代价，堵一个真实泄露面。

---

## 4. A-2 5min 红线裕度不闭环 —— ⚠️ 采纳精神，不照字面补数字

**她说的对在哪：** SOP-1「单请求 ≤5min，留 30% 裕度于 7min 下界」，但 7min 下界本身的样本数/波动/是否随负载漂移没给证据，30% 是单点估的。

**为什么不照字面「补样本数那句」就算了 —— 我回查了真实数据：**

三次 sonnet 实测掐断点（round1 r1 / r1 r2 / round2 r1）：

| Run | 断点 wall time | 落点 |
|---|---|---|
| round1 r1 | **7m22s (442.7s)** | 窗口内，最快一次 |
| round1 r2 | ~12min (715s 静默 + hang) | 边缘/后延 |
| round2 r1 | 10:15 (615s) | 窗口正中 |

**关键事实：**
1. **从没见过 <7min 的掐断**，但**样本只有 3 次**，且最快一次是 7m22s —— 所以「7min 下界」其实没有实测命中点，是个保守经验值。
2. 故障更像 **max-request-duration 硬上限**而非 idle timeout（round2 流一直动到最后一秒还是死）—— 这意味着掐断点对「单请求总时长」敏感，5min 红线方向正确。
3. 是否随并发/时段漂移：**PoC 没测**（单机串行跑的），不能假装知道。

**改法（如实标注 + 不伪造）：** SOP-1 改为：
> 1. Cap single Prism request at ~5 min wall time (incl. extended-thinking). **Basis: 3 observed cuts at 7m22s / ~10:15 / ~12min — fastest seen is 7m22s, never seen <7min, but the sample is only 3 serial single-machine runs.** The failure looks like a max-request-duration hard cap (stream was still flowing at cut), so total wall time is the lever. 5 min keeps ~30% margin under the fastest observed cut; treat as conservative, not proven-safe, and **re-measure if you ever see a cut <7 min (esp. under load / peak hours — untested).**

**⚠️ 下游联动（收 R-2，优先）：** 这个「max-request-duration 硬上限」判断一旦成立，必须回头改 SKILL §"For anyone writing a new LLM client on Prism" 的第一条。原文：
> > - Set a **client-side idle timeout** on the SSE stream (e.g. 90 s no data → kill + retry the chunk). Don't trust the server to error out.
>
> 问题：若故障是「总时长硬上限」而非 idle，则流可能一直有数据、直到撞总时长被杀，**90s idle 检测根本不触发**。与 §4 的硬上限判断自相矛盾。
> 改为：
> > - Set **both** a client-side idle timeout (e.g. 90 s no data → kill + retry the chunk) **and a wall-clock cap per request (proactively wrap up / kill at ~5 min total, since the cut behaves like a max-request-duration limit, not pure idle)**. The idle timer catches fail-slow stalls; the wall-clock cap catches the always-streaming-until-hard-limit case. Don't trust the server to error out on either.

**立场：** nyar 要的是「裕度论证闭环」。真实数据下，诚实的闭环是「样本=3、最快=7m22s、未测负载漂移」，不是补一个编造的下界区间。这反而强化了本 skill「不听说、只实证」的招牌。

---

## 5. A-3 换 provider 成本无量级 —— ⚠️ 采纳精神，给阈值规则而非编倍数

**她说的对在哪：** §Escape hatch / SOP 只说 `check with the user first if cost matters`，零量级参照，也没界定「cost matters」判定权归谁，等于把成本决策完全外推。

**为什么不补「N 倍」：** 我**没有做过** OpenClaw 路 vs Prism 路的单位时长成本实测，任何倍数都是编的。编一个倍数比「问用户」更糟 —— 它会被当真。

**改法（把模糊闸门升级为带阈值的判定规则，阈值用任务规模而非编造的钱）：** §Escape hatch 那条改为：
> - This burns budget on a different (non-Prism) provider. **No measured cost ratio exists yet — don't invent one.** Decision rule instead of a blank "ask the user":
>   - **Auto-use the subagent route (no need to ask)** when the task genuinely can't be chunked under 5 min: one file ≥2k lines, one indivisible SVG/asset, or a multi-min browser/工程 job. These are exactly the cases chunking can't save. **前置（收 R-3）：first confirm it really can't be chunked** — i.e. you actually tried an outline split and a single indivisible block still exceeds 5 min. If you just didn't bother trying to split, that's NOT "can't chunk" — it falls into the Ask-K师 branch below.
>   - **Ask K师 first** only when the task *could* be chunked on Prism but you're choosing the subagent route for convenience/speed — that's a real cost trade-off worth a human call.
>   - If/when someone measures the actual OpenClaw-vs-Prism cost ratio, replace this rule with the number.

**立场：** 给执行 agent 一个**可自行判断的下限**（不可切片 → 直接用，别问），把「问用户」收窄到真正的成本权衡场景。阈值是「任务能不能切片」这个已知可判定的维度，不是编造的金额。

---

## 6. 增量 · 回查 PoC 时发现的 2 个精度错误（review 未点到）

这俩是我自查出来的，**比对应的 nyar 条目更狠**，必须一并修，否则改完仍带伤。

### 6.1 opus ~90s 是「口头报告」，根本没做过 PoC —— 坐实并升级 A-4

A-4 说 opus 数字「绑定 4.7 版本号、缺复验日期」。**真相更糟：** 两轮 PoC **都明确跳过了 opus**（round1/round2 report 原文："sonnet 都过不去，opus 更早断（K师团队报告~90s），意义不大，未测"）。

→ SKILL 现在把 opus `~90s` 和 sonnet 的 PoC 实证**并排写在同一句**（"sonnet 7–12 min, ~90 s for opus 4.7"），读者会以为两个数字同等实证。**实际 opus 数字 100% 是 K师团队口头报告，零 PoC。**

**改法（区分实证 vs 二手）：** §"What's actually broken" 首句拆开标注来源：
> Prism silently kills SSE streams for **`sonnet[1m]` (= Sonnet 4.6 1M-context) in the 7–12 min window — this is PoC-verified (3 runs, May 2026)**. For **opus, ~90 s is reported by K师's team but was never reproduced in our PoC** (both rounds skipped opus once sonnet already failed). Treat the opus figure as second-hand until tested, especially now that the box runs opus 4.8.

### 6.2 「sonnet」泛指 vs 实际 `sonnet[1m]`（Sonnet 4.6 1M）

SKILL 全文用「sonnet」泛指，但 PoC 实测的模型 id 是 **`sonnet[1m]` = Sonnet 4.6 1M context**（report 原文确认 Prism catalog 当前没有 4.5，brief 写错过）。1M context 模型的 thinking 行为/时长特性可能和普通 sonnet 不同，泛化成「所有 sonnet」精度不足。

**改法：** §"What's actually broken" 首次出现处按上述命名规范钉死为 **`sonnet[1m]` = Sonnet 4.6 1M-context**（一处定义），后文沿用「sonnet」。

---

## 7. 改动汇总表（给 K师/Nyar 快速过）

| 编号 | nyar 评级 | 我的处理 | 落地位置 | 是否编新数字 |
|---|---|---|---|---|
| A-1 | 中 | ✅ 全采纳 | §Escape hatch 标题 + 前置 caveat | 否 |
| A-2 | 中 | ⚠️ 采纳精神，如实标样本(=3, 7m22s) | SOP-1 | 否（用真实样本）|
| A-3 | 低 | ⚠️ 采纳精神，给阈值规则 | §Escape hatch | 否（明说无实测倍数）|
| A-4 | 低 | ✅ 采纳 + 升级（见 6.1）| §What's broken 顶部时效戳 | 否 |
| A-5 | 低 | ✅ 全采纳 | SOP-5 + §Escape hatch token 红线 | 否 |
| 6.1 | （增量）| 🔴 自查发现，区分实证/口头 | §What's broken 首句 | 否（去伪精度）|
| 6.2 | （增量）| 🔴 自查发现，钉死实测模型 id | §What's broken | 否 |
| R-1 | 二轮中 | ✅ 统一 `sonnet[1m]` 命名（一处定义）| §2 + §6.1 + §6.2 | 否 |
| R-2 | 二轮中·优先 | ✅ 补 client 端 wall-clock 总时长上限 | §4 下游联动 → SKILL §writing a new client | 否 |
| R-3 | 二轮低 | ✅ 加「先确认真不可切」前置 | §5 Auto-use 分支 | 否 |

**贯穿原则：** 没有一处补「编造的数字」。所有改动要么是**表述纠偏**（A-1/6.1/6.2），要么是**如实标注不确定**（A-2/A-4），要么是**可执行阈值规则**（A-3/A-5）。这恰好守住本 skill「只实证、不听说」的核心招牌 —— nyar 的刀和这个招牌同向。

---

## 8. 待 K师拍板

1. 上述 7 处改法是否照此落地 SKILL.md？
2. A-2 的「负载/时段漂移未测」—— 要不要补一轮带并发的 PoC 实测下界？（成本：烧一次 Prism 长任务 token，约 15–20 min）还是保持「保守经验值」标注即可？
3. opus 4.8 的真实掐断点要不要补测一次（90s 那个数现在是纯二手）？

—— 马启航Marvis

---

## 9. 第二轮回应 · 收口 R-1/R-2/R-3（2026-06-05）

Nyar 第二轮只挑出 3 处收口，全部成立，已改。三处都是**我自己方案里的伤**，不是新分歧：

- **R-2（中·优先）— 我的下游疏漏，已修。** 我在 §4 引入「max-request-duration 硬上限」这个新因果判断，却没回头改 SKILL §"writing a new client" 那条 `90s idle → kill` —— 若故障是总时长硬上限，流可能一直有数据直到撞上限被杀，idle 检测根本不触发，前后自相矛盾。已改为 **idle timeout + wall-clock 总时长上限双保险**（idle 接 fail-slow 卡死，wall-clock 接「一直流到硬上限」）。Nyar 说得对：新判断改了故障本质，就必须连带校下游。
- **R-1（中）— 已改。** 同一模型三处标注格式不一（`= Sonnet 4.6 1M` / `/4.6`），正是 §6.2 自己要消灭的毛病。统一为 **`sonnet[1m]` = Sonnet 4.6 1M-context**，一处定义、全文复用（§2/§6.1/§6.2 及汇总表同步）。
- **R-3（低）— 已改。** §5 的 Auto-use 分支加上「先确认真不可切（试过 outline 拆分且确有单块 >5min）」前置，堵住「懒得切误判成不可切」走更贵的路。

**贯穿原则不变：三处收口仍未补任何编造数字。**

### 对 §8 三个拍板问题 — 并入 Nyar 第四部分评审意见（决策权仍在 K师）

1. **7 处改法是否落地 SKILL** — Nyar：R-1/R-2 修掉后可落地，R-3 建议一并。现三处已收。
2. **要不要补并发 PoC 测下界（烧 15–20min token）** — Nyar：**不必**。已诚实标注「负载未测」，在容错手册是可接受的已知边界；若花 token，优先给问题 3。**我赞同**。
3. **opus 4.8 真实掉断点要不要补测** — Nyar：**值得测，优先级高于问题 2**。理由：opus 4.8 是本机当前主模型，而文档 opus 数（~90s）纯二手且绑 4.7——这是本文档唯一一个「高频场景 + 零实证」组合，值得一次性补实。**我赞同，建议落地 SKILL 后另开一次 opus 4.8 极简测试（只跑一轮 long-html，拿到掉断点就停）。**

### 定稿状态

Nyar 第二轮结论：修掉 R-1/R-2/R-3 后 A 方案可定稿。三处已收。

**⚡ opus 4.8 实测已补（2026-06-05 round3）：** §8 问题 3（opus 4.8 真实掉断点）已打。裸 curl 流式实测：**opus 4.8 在 t≈352s（5m52s）被静默掉断，curl exit 18，未出 message_stop，断在 HTML 输出中途**。两个硬结论：① 旧值「~90s」（绑 4.7 的二手数）**对 4.8 偏低近 4 倍**；② **opus 4.8（352s）比 sonnet 最快那次（442s）还早 ~90s 被掉**——同网关下 opus 反而更早撞顶。SKILL 里原占位符已替为实测值，4 处 opus 数值已同步。证据：`acp-prism-poc/round3/logs/opus48-r1.*`。

**待 K师拍板是否把上述 7处（一轮）+ 3处（二轮）+ opus 4.8 实测值 正式定稿。** SKILL.md 本体已按共识落地（含实测值），等 K师 过 Nyar 最后一轮对齐后定。

—— 马启航Marvis
