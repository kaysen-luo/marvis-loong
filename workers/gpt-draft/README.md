# gpt-draft · MVS-010 云端草稿箱 Worker

零知识(zero-knowledge)云端草稿:服务端只见密文,密码永不离开浏览器。

- 前端:PBKDF2-SHA256(210k iter) 派生 32-byte key + HMAC 派生 owner id
- 传输:AES-GCM 密文
- 存储:Cloudflare KV
- API:见下

## 部署 SOP

```bash
cd ~/marvis-loong-site/workers/gpt-draft

# 1. 创建 KV namespace(只需一次)
wrangler kv namespace create GAME_PRD_DRAFTS
# 输出会给出 id,把 id 写进 wrangler.toml 的 [[kv_namespaces]] 的 id 字段

# 2. 部署
wrangler deploy
# 输出会给出类似 https://gpt-draft.<subdomain>.workers.dev 的 URL

# 3. 查看日志(可选)
wrangler tail
```

## 部署后的当前状态

- Worker URL: `https://gpt-draft.marvis-loong.workers.dev`(部署后由 wrangler 输出确定)
- KV binding: `DRAFTS` → namespace `GAME_PRD_DRAFTS`

## API 契约

所有响应 `Content-Type: application/json; charset=utf-8`
CORS 允许:`https://marvis-loong.pages.dev` + dev 本地端口

### `GET /list?owner=<hex>`

- 200 → `{ "drafts": [{ "name": "...", "updatedAt": 1719923000000, "size": 12345 }] }`

### `GET /draft?owner=<hex>&name=<name>`

- 200 → `{ "ciphertext": "base64", "iv": "base64", "salt": "base64", "updatedAt": 171... }`
- 404 → `{ "error": "draft not found" }`

### `PUT /draft?owner=<hex>&name=<name>`

- body: `{ "ciphertext": "base64", "iv": "base64", "salt": "base64" }`(≤ 100KB)
- 200 → `{ "ok": true, "updatedAt": 171... }`
- 413 payload too large

### `DELETE /draft?owner=<hex>&name=<name>`

- 200 → `{ "ok": true }`

### 通用错误

- 400 `{ "error": "invalid owner" | "invalid name" | "body must be JSON" | ... }`
- 405 `{ "error": "method not allowed" }`
- 429 `{ "error": "rate limited" }`(每 IP 每分钟 60 次)

## 参数约束

- `owner`:hex 4~64 字符(前端派生固定 16 字符)
- `name`:允许字母数字下划线中划线点空格中文,长度 1~128
- 单份草稿:≤ 100KB(密文)

## 数据模型

- `draft:<owner>:<name>` → `{ ciphertext, iv, salt, updatedAt }`
- `owner:<owner>:index` → `{ names: [name1, name2, ...] }`
- `rl:<ip>:<minuteBucket>` → 计数(TTL 65s)

## 安全模型

1. **owner 隔离**:owner id 由前端 HMAC-SHA256(userKey, fixedMarker) 派生。不同密码 → 不同 owner。服务端不做校验,owner 只是命名空间。
2. **无账号**:服务端不知道任何用户身份,只有 owner hex → 一堆密文。
3. **密码不上传**:PBKDF2 + AES-GCM 全部在浏览器 Web Crypto。
4. **忘密码=数据丢失**:没有服务端 recovery。刻意设计。

## 后续可优化

- WAF 规则:限制到只允许 pages.dev 来源
- 加 D1 记录 owner 使用量/上次访问时间(仍不含明文)
- 添加 versioning:同名 draft 保留旧版本
- 加 batch API:一次拉多份草稿元信息
