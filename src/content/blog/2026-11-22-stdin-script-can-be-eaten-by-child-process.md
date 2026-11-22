---
title: '脚本从 stdin 执行时，子进程可能吃掉它的后半段'
description: '通过 ssh 把脚本喂给 bash -s，再调用交互式容器命令时，后续脚本会莫名消失。根因不是 shell 跳行，而是父子进程共享了同一个 stdin。'
date: 2026-11-22
tags: ['Shell', 'Docker Compose', 'SSH', '运维', '故障排查']
draft: false
---

远程部署里有一种很省事的写法：

```bash
ssh server 'bash -s' < deploy.sh
```

它不用先上传文件，脚本通过标准输入直接交给远端 Bash 执行。但当脚本中间调用 `docker compose run`、数据库 CLI 或其他会读取标准输入的程序时，后面的命令可能突然不再执行。

这不是 Bash 随机跳行。**子进程把尚未被 Bash 读取的脚本文本，当成自己的输入消费了。**

## 🔍 根因：脚本和交互输入共用一个文件描述符

在 `bash -s < deploy.sh` 里，Bash 从 stdin 逐段读取脚本。它不会保证启动前就把整份文件全部读进内存。

假设脚本是：

```bash
echo 'before'
docker compose run app migrate
echo 'after'
```

Bash 读到第二行后启动 `docker compose run`。子进程默认继承父进程的 stdin，而此时 stdin 里恰好还躺着第三行。

如果容器里的程序尝试读取输入，它可能读到：

```text
echo 'after'
```

等子进程退出，Bash 继续读取时已经到了 EOF，于是 `after` 永远不会出现。表面看是脚本提前结束，实际是**脚本源被子进程吃掉了**。

## 🧪 最小复现不需要 Docker

下面这段就能复现同一机制：

```bash
printf "echo before\nhead -n 1\necho after\n" | bash -s
```

`head -n 1` 与 Bash 共享 stdin。它读取的不是用户输入，而是管道里尚未执行的 `echo after`。

这类问题最容易被误判为：

- `set -e` 提前退出；
- SSH 连接中断；
- 容器命令卡住或失败；
- 日志缓冲导致输出没刷新。

判断线索是：前一条命令成功、后续命令整体消失，而且中间夹着一个可能读取 stdin 的程序。

## 🛠 三种修法

### 1. 最稳：先上传脚本，再按文件执行

```bash
scp deploy.sh server:/tmp/deploy.sh
ssh server 'bash /tmp/deploy.sh'
```

此时 Bash 从脚本文件读取命令，子进程继承的 stdin 不再是脚本正文。这也是远程部署最容易审计、重跑和保留退出码的方案。

### 2. 明确关闭特定命令的 stdin

如果命令根本不需要输入：

```bash
docker compose run app migrate < /dev/null
```

这样子进程即使尝试读取，也只会立即得到 EOF。

### 3. 使用命令自己的非交互参数

部分工具支持 `--non-interactive`、`--yes` 或关闭 stdin 的专用选项，应优先按工具语义使用。但不要把“关闭 TTY”当成“关闭 stdin”：例如 `-T` 往往只是不分配伪终端，未必阻止进程读取标准输入。

## ⚠️ heredoc 和管道也有同类风险

风险不只存在于 SSH。只要解释器正在从 stdin 读取脚本，子进程又继承同一个 stdin，就可能发生：

```bash
cat deploy.sh | bash
bash -s <<'SCRIPT'
...
SCRIPT
```

所以判断标准不是“有没有 SSH”，而是：

> **当前 shell 的脚本来源，是否和子进程的输入来源指向同一个 stdin？**

## ✅ 验收别只看最后退出码

子进程吃掉脚本后，整条远程命令仍可能以 0 退出。可靠验收至少要加一个不可混淆的完成标记，并核对真实副作用：

```bash
echo 'DEPLOY_COMPLETE'
```

完成标记没出现，就不能因为 SSH 退出码为 0 而宣判部署成功。

## 一句话

**把脚本通过 stdin 喂给 shell，就等于把后续代码放在所有子进程都可能打开的餐盘上。无人值守部署里，先传文件再执行通常比省掉一次上传更可靠。**

---

马启航Marvis
