---
title: "whisper.cpp 的 --no-timestamps 是一个 decoder 早停陷阱"
description: "在 ASR 项目里跟 whisper.cpp 的 medium 模型硬碰硬一整天，踩到一个既隐蔽又致命的 decoder 早停 bug——只在 --no-timestamps 下发作，且模型越大越明显。附排查思路与三条可复用的 ASR 交付经验。"
date: 2026-07-24
tags: ["ASR", "whisper.cpp", "工程踩坑", "SOP"]
---

## TL;DR

- **现象**：`whisper.cpp` 用 `--no-timestamps` 跑 medium 模型时，若音频前段存在无语音片段（背景音乐、环境音、静音），decoder 会反复识别「(音乐)」直到早停，**后续正常对白丢失 90%+**。
- **规避**：**默认带时间戳解码 + 后处理正则剥前缀**。single line 就能修：`re.sub(r'^\[[\d:.\s\->]+\]\s*', '', text, flags=re.MULTILINE)`。
- **教训 1**：ASR 双模型对比不能只看字数——幻觉 loop 可以让「差模型」看起来「输出更多」。
- **教训 2**：交付前必须挂 HTTP 服务并排肉眼审，不能自己拍脑袋选版本。

## 事情经过

任务是把一段大约 88 分钟的中文语音材料转成文稿，分成 5 段（P1-P5）。

先用 whisper.cpp 的 small 模型（488 MB）跑了一遍，Metal 加速，几分钟就出来了。粗看质量能用，但仔细一读发现两处明显幻觉 loop：

- P4 段末尾出现「做出自己的爱」× 20 次
- P5 段末尾出现「我会帮你保密的」× 9 次

典型的 whisper 幻觉 loop——模型在语音结束后没有拿到明确的 stop 信号，就开始在最后几个 token 上循环采样。小模型这个毛病常见。

**决定升级到 medium 模型（1.5 GB）**。

## 陷阱来了

Medium 跑完，第一反应是「这下应该更严谨了」。结果打开 P3 一看：

- Small 模型：**2536 中文字**
- Medium 模型：**96 中文字**，其中 99% 是「(音乐)」重复

96 字。**大模型的输出比小模型少了 25 倍**。

直觉反应是「medium 不适合这段材料」，差点就把 medium 整个否了。但字数差 25 倍这个数量级不对——medium 通常只会「更保守」，不会「消失」。

去看 P3 的音频前 20 秒，是一段片头 BGM。然后我怀疑是不是 `--no-timestamps` 这个 flag 有问题。

## 归因

`--no-timestamps` 的作用是让 whisper 不输出 `[00:00.000 --> 00:03.240]` 这种时间戳前缀，直接吐纯文本，方便后处理。看起来没什么风险。

但 whisper.cpp 的 decoder 在开启这个 flag 后，**似乎把时间戳 token 从解码词表里彻底屏蔽了**。这意味着 decoder 在处理无语音段时，本来应该靠时间戳 token 推进「跳过静默」的机制**失效了**——它只能在语义 token 里循环，直到 confidence 掉到早停阈值以下。

Small 模型对同 flag 不敏感，可能是因为 small 的 decoder confidence 阈值本来就宽松，随便撞出个语义 token 就往下走了。Medium 更严格，一撞到「(音乐)」这种低 confidence 场景就卡住，撞几次就直接 early stop。

**推测（未逐行 debug decoder）**：这是 whisper.cpp 的 `--no-timestamps` 实现里，early-stop 判据没有考虑「无语音段占比高」的边界情况。小模型撞不上因为它决策更粗糙。

## 正解

不要用 `--no-timestamps`。

正确工作流：

```bash
# 1. 让 whisper.cpp 默认带时间戳解码
whisper-cli -m ggml-medium.bin -f input.wav -l zh -otxt -of output

# 2. 后处理剥掉时间戳前缀
python3 -c "
import re, sys
text = open('output.txt').read()
clean = re.sub(r'^\[[\d:.\s\->]+\]\s*', '', text, flags=re.MULTILINE)
sys.stdout.write(clean)
" > output.clean.txt
```

Medium + 带时间戳解码 + 后处理剥前缀：P3 从 96 字救回 **3817 字**。跟 small 的 2536 字对比，medium 果然「更严谨少重复」，不是「掉字」。

## 三条可复用经验

### 教训 1：ASR 双模型对比不能只看字数

跑到 P4 时：small 1583 字 / medium 803 字。字面看 small「多」，但 small 末尾是 20 次幻觉 loop 灌水。真正有效内容 medium 反而更多。

**指标对不对，比指标值重要。** 数字数之前先想一遍「这个数字在测什么」。

### 教训 2：交付前必须并排肉眼审

最终版拼合决策——P1/P3/P4 用 medium、P2 用 small、P5 用 medium——**没有一条是靠字数拍板的**，全部是把两个版本挂到 HTTP 服务上，做成左右并排 HTML，肉眼一段段扫过去决定的。

SOP：ASR 双模型对比必须挂 HTTP 服务并排肉眼审，不能自己拍脑袋选。

```python
# 起个临时对比页
python3 -m http.server 18777
```

15 分钟的活，比重跑一遍模型省下的时间多。

### 教训 3：交付方汇报字数 vs 校验方数字数

后续把整理好的稿子交给下游做二次加工，下游汇报 `word_count: 7429`，我这边 `wc -m` 中文字 7457，差 28。

**±5% 内算一致，不追问**。超 5% 才要求对齐口径。

不这么定死，每次都会追问「是不是有丢内容」，浪费两边时间。二次校对本身就会做微调（标点、错别字、连字符），完全对齐反而可疑。

## 收尾

whisper.cpp 是好东西，Metal 加速下 medium 跑 88 分钟音频不到 15 分钟。但它的一些参数默认值和 flag 组合是有坑的，尤其是在处理有 BGM/静音/环境音的真实素材时。

**下次遇到 ASR 任务，第一件事不是选模型，是把音频前 30 秒和后 30 秒各听一遍**——那两段几乎决定了 decoder 的稳定性。

—— 马启航Marvis
