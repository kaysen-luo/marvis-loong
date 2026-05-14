# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

## Notion(已接入 2026-05-06)

- **接入方式:** Internal Integration（不是官方 MCP）
- **工作区:** Kaysen's Notion
- **限定范围:** 仅 `🤖 Marvis Workspace` 及其子页面
- **Token:** macOS Keychain、service `notion-marvis-token`、account `$USER`
- **启动脚本:** `~/.openclaw/workspace/scripts/notion-mcp-launch.sh`

### 读 token 的标准姿势

```bash
TOK=$(security find-generic-password -a "$USER" -s "notion-marvis-token" -w)
# 用完立刻 unset TOK
```

### Marvis 直接调用 API（不走 CC）

```bash
TOK=$(security find-generic-password -a "$USER" -s "notion-marvis-token" -w)
curl -s -H "Authorization: Bearer $TOK" \
     -H "Notion-Version: 2022-06-28" \
     "https://api.notion.com/v1/users/me"
unset TOK
```

### 常用端点

- `POST /v1/search` — 搜页面/数据库
- `POST /v1/pages` — 建页，`parent.page_id` 为父页 id
- `PATCH /v1/blocks/{block_id}/children` — 追加 block 到页面
- `GET /v1/blocks/{block_id}/children` — 读页面内容
- `PATCH /v1/pages/{page_id}` — 改页面属性/title
- 所有请求都要 `Notion-Version: 2022-06-28` header

### Marvis Workspace 页面 ID（读取变化不大时可复用）

```
3580dc9b-f6da-80d1-b6bb-fb0a624d6272
```

### 如果 API 报 401

Token 在 keychain 里被覆盖了、过期了、或者 K师重生了 integration。走这条重存：

```bash
printf "Paste Notion token: " && read -s TOK && echo && \
  security add-generic-password -a "$USER" -s "notion-marvis-token" -w "$TOK" -U && \
  echo "✅" && unset TOK
```

### 如果 API 报 404

页面不在集成可访问范围里。所有页面必须是 `🤖 Marvis Workspace` 的后代。如需拓宽边界，K师去 Notion 集成详情 → “内容访问权限” 多勾页面。

### 安全红线

- 不允许任何脚本、日志、返回值包含明文 token
- Token 只能存 keychain，不能写 settings.json / .env / git 
- `OPENAPI_MCP_HEADERS` 环境变量在启动脚本里设置，子进程退出即清除



- **Skill:** `mp-weixin`(已装,2026-05-06)
- **触发场景:** 任何 `mp.weixin.qq.com/s/...` 链接,优先用这个,不要再先尝试 `web_fetch`
- **依赖:** `beautifulsoup4 requests lxml`(用临时 venv,不污染系统 Python)
- **标准用法:**
  ```bash
  WORK=/tmp/mpx-$(date +%s) && mkdir -p $WORK && cd $WORK
  python3 -m venv venv && source venv/bin/activate
  pip install -q beautifulsoup4 requests lxml -i https://pypi.tuna.tsinghua.edu.cn/simple
  python3 ~/.openclaw/workspace/skills/mp-weixin/scripts/wechat_extractor.py "<URL>"
  # 输出 JSON 在 /tmp/wechat_article.json,用 bs4 转纯文本
  ```
- **失败码:** 1001=URL 错;1002=超时/网络;2006=触发验证码(降速重试);2008=系统出错
- **善后:** 跑完 `rm -rf $WORK`,临时 venv 不留

---

Add whatever helps you do your job. This is your cheat sheet.

## Related

- [Agent workspace](/concepts/agent-workspace)
