# Game Design Skills · 适配版 INDEX

源：[MRCalderon3D / everything-game-dev-code](https://github.com/MRCalderon3D/everything-game-dev-code)
适配：**马启航Marvis** · 2026-05-14
目标位置（K师评审后）：`~/.openclaw/workspace/skills/`

## 11 个 skill 概览

| # | Skill 名 | 一句话触发场景 | 安全审计 |
| --- | --- | --- | --- |
| 1 | game-design-core-loop | 定义和打磨游戏核心循环与副循环 | ✅ 全清 |
| 2 | game-design-combat | 设计战斗动作动词、敌人压力、资源经济、可读性与调参 | ✅ 全清 |
| 3 | game-design-level | 设计关卡的空间流、节奏、导航、遭遇编排与空间化教学 | ✅ 全清 |
| 4 | game-design-economy-balancing | 设计与调参货币 / 消耗点 / 奖励 / 定价 / 通胀控制 | ✅ 全清 |
| 5 | game-design-progression | 设计短期与长期养成结构，支撑成长感与留存 | ✅ 全清 |
| 6 | game-design-monetization | 设计契合产品、尊重玩家、合规可控的商业化系统 | ✅ 全清 |
| 7 | game-design-liveops | 设计赛季 / 活动 / 上线后内容，不破坏核心稳定性 | ✅ 全清 |
| 8 | game-design-narrative | 构建叙事结构、世界观逻辑、对话意图与玩家动机 | ✅ 全清 |
| 9 | game-design-quest | 设计任务的状态机、门槛、分支与玩家引导 | ✅ 全清 |
| 10 | game-design-onboarding-tutorial | 设计新手引导与教学，支撑留存而非造成认知过载 | ✅ 全清 |
| 11 | game-design-accessibility | 将无障碍作为设计决策内嵌进流程，而非上线前补丁 | ✅ 全清 |

## 安全审计结论

**11 个源 skill 全部清白，无任何警告。**

逐项核查项目：
- ❌ 无 curl / wget / ssh / scp / rm -rf / chmod / chown 等系统命令
- ❌ 无引用敏感路径（~/.ssh / .env / token / keychain）
- ❌ 无外发邮件 / API 调用
- ❌ 无引擎专有代码（Unity / Unreal / Godot）
- ❌ 无可执行脚本

源 skill 全部是**纯方法论 Markdown**，骨架统一（Purpose / Use When / Inputs / Process / Outputs / Quality Bar / Common Failure Modes），适配工作主要是：
1. 全文中译（保留关键英文术语 + 中文括号注解）
2. 重写 description 为「中文 + 明确触发场景」
3. 替换通用 Quality Bar / Failure Modes 为更具针对性的清单
4. 注入 4 把尺子（第一性原理）与「马启航Marvis」署名规范
5. 新增「输出模板」段，让 subagent 有可直接填的骨架

## 适配版统一注入项

每个 skill 末尾「协作注意事项」都包含：
- **4 把尺子提醒**：WHY 清楚 / 路径最短 / 决策能回答为什么 / 输出能改决策
- **署名规范**：任何对外交付物署名统一用「马启航Marvis」
- **协作纪律**：不确定的方向先列 A/B/C 选项给 K师拍板

## 给 K师的建议

**可以立刻搬进生产位置（`~/.openclaw/workspace/skills/`）的：** 全部 11 个

理由：源 skill 安全，适配后无可执行代码、无外部依赖、纯方法论。即便 subagent 误调用也不会有副作用。

**搬运命令（建议 K师评审后亲自执行）：**
```bash
# 备份（万一）
cp -r ~/.openclaw/workspace/skills ~/.openclaw/workspace/skills.bak.$(date +%Y%m%d)
# 搬运
cp -r /tmp/skill-recon-game/adapted/game-design/* ~/.openclaw/workspace/skills/
```

**可选优化方向（后续迭代再考虑）：**
- 增加「资源 / references」目录，附 K师自己积累的优秀案例（如他喜欢的某款游戏 core loop 拆解）
- 增加交叉引用：例如 `game-design-quest` 在「何时使用」里加链接指向 `game-design-narrative`
- 考虑做一个 meta-skill `game-design-router`，让 subagent 拿到任务能自动路由到合适的 design skill

---
署名：**马启航Marvis** 🐉
