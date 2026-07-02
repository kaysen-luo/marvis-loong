/**
 * MVS-010 game-prd-tool · zero-knowledge cloud drafts Worker
 * ----------------------------------------------------------
 * 服务端只见密文。密码只在浏览器,PBKDF2 派生 key + owner。
 * KV 结构:
 *   draft:<owner>:<name>   → {ciphertext, iv, salt, updatedAt}
 *   owner:<owner>:index    → {names: [name1, ...]}
 *   rl:<ip>:<minuteBucket> → 计数(TTL 60s)
 *
 * API:
 *   GET    /list?owner=<hash>
 *   GET    /draft?owner=<hash>&name=<name>
 *   PUT    /draft?owner=<hash>&name=<name>  body {ciphertext, iv, salt}
 *   DELETE /draft?owner=<hash>&name=<name>
 */

export interface Env {
  DRAFTS: KVNamespace;
}

const ALLOWED_ORIGIN = "https://marvis-loong.pages.dev";
// dev origins let 本地 http server 测试通过(生产不影响)
const DEV_ORIGINS = new Set([
  "http://127.0.0.1:8899",
  "http://localhost:8899",
  "http://127.0.0.1:4321",
  "http://localhost:4321",
  "http://127.0.0.1:4322",
  "http://localhost:4322",
]);

const MAX_BODY_BYTES = 100 * 1024; // 100KB 单份草稿上限
const MAX_NAME_LEN = 128;
const MAX_OWNER_LEN = 64;
const RATE_LIMIT_PER_MIN = 60;

function pickAllowOrigin(request: Request): string {
  const origin = request.headers.get("Origin") || "";
  if (origin === ALLOWED_ORIGIN) return ALLOWED_ORIGIN;
  if (DEV_ORIGINS.has(origin)) return origin;
  return ALLOWED_ORIGIN;
}

function corsHeaders(request: Request): HeadersInit {
  const origin = pickAllowOrigin(request);
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(request: Request, body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
      ...(extraHeaders || {}),
    },
  });
}

function badRequest(request: Request, msg: string): Response {
  return jsonResponse(request, { error: msg }, 400);
}

function notFound(request: Request, msg = "not found"): Response {
  return jsonResponse(request, { error: msg }, 404);
}

function methodNotAllowed(request: Request): Response {
  return jsonResponse(request, { error: "method not allowed" }, 405);
}

function tooLarge(request: Request): Response {
  return jsonResponse(request, { error: "payload too large" }, 413);
}

function rateLimited(request: Request): Response {
  return jsonResponse(request, { error: "rate limited" }, 429, { "Retry-After": "60" });
}

function serverError(request: Request, msg: string): Response {
  return jsonResponse(request, { error: msg }, 500);
}

// ---- validation ----

const OWNER_RE = /^[a-f0-9]{4,64}$/i;
const NAME_RE = /^[\w\-. \u4e00-\u9fff]{1,128}$/u;

function validateOwner(v: string | null): string | null {
  if (!v) return null;
  if (v.length > MAX_OWNER_LEN) return null;
  if (!OWNER_RE.test(v)) return null;
  return v.toLowerCase();
}

function validateName(v: string | null): string | null {
  if (!v) return null;
  if (v.length > MAX_NAME_LEN) return null;
  if (!NAME_RE.test(v)) return null;
  return v;
}

// ---- rate limit (KV-based, per-IP per-minute bucket) ----

async function checkRateLimit(env: Env, request: Request): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `rl:${ip}:${bucket}`;
  const cur = await env.DRAFTS.get(key);
  const n = cur ? parseInt(cur, 10) : 0;
  if (n >= RATE_LIMIT_PER_MIN) return false;
  // TTL 65s 覆盖桶跨秒
  await env.DRAFTS.put(key, String(n + 1), { expirationTtl: 65 });
  return true;
}

// ---- handlers ----

async function handleList(request: Request, env: Env, url: URL): Promise<Response> {
  const owner = validateOwner(url.searchParams.get("owner"));
  if (!owner) return badRequest(request, "invalid owner");
  const raw = await env.DRAFTS.get(`owner:${owner}:index`);
  if (!raw) return jsonResponse(request, { drafts: [] });
  let names: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.names)) names = parsed.names.filter((x: unknown) => typeof x === "string");
  } catch {
    names = [];
  }
  // 并发 fetch 每份 draft 的 meta(updatedAt + size)
  const drafts = await Promise.all(
    names.map(async (name) => {
      const key = `draft:${owner}:${name}`;
      const draftRaw = await env.DRAFTS.get(key);
      if (!draftRaw) return null;
      let updatedAt = 0;
      let size = draftRaw.length;
      try {
        const obj = JSON.parse(draftRaw);
        if (typeof obj?.updatedAt === "number") updatedAt = obj.updatedAt;
        if (typeof obj?.ciphertext === "string") size = obj.ciphertext.length;
      } catch { /* ignore */ }
      return { name, updatedAt, size };
    })
  );
  const filtered = drafts.filter((x): x is { name: string; updatedAt: number; size: number } => x !== null);
  // 按 updatedAt 降序
  filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  return jsonResponse(request, { drafts: filtered });
}

async function handleGetDraft(request: Request, env: Env, url: URL): Promise<Response> {
  const owner = validateOwner(url.searchParams.get("owner"));
  const name = validateName(url.searchParams.get("name"));
  if (!owner) return badRequest(request, "invalid owner");
  if (!name) return badRequest(request, "invalid name");
  const raw = await env.DRAFTS.get(`draft:${owner}:${name}`);
  if (!raw) return notFound(request, "draft not found");
  try {
    const obj = JSON.parse(raw);
    return jsonResponse(request, obj);
  } catch {
    return serverError(request, "corrupt draft");
  }
}

async function handlePutDraft(request: Request, env: Env, url: URL): Promise<Response> {
  const owner = validateOwner(url.searchParams.get("owner"));
  const name = validateName(url.searchParams.get("name"));
  if (!owner) return badRequest(request, "invalid owner");
  if (!name) return badRequest(request, "invalid name");
  const ct = request.headers.get("Content-Length");
  if (ct && parseInt(ct, 10) > MAX_BODY_BYTES) return tooLarge(request);
  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return badRequest(request, "cannot read body");
  }
  if (bodyText.length > MAX_BODY_BYTES) return tooLarge(request);
  let body: any;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return badRequest(request, "body must be JSON");
  }
  if (typeof body?.ciphertext !== "string" || typeof body?.iv !== "string" || typeof body?.salt !== "string") {
    return badRequest(request, "missing ciphertext/iv/salt");
  }
  // 服务端不解密,不校验密文格式,仅存字符串
  const updatedAt = Date.now();
  const draftObj = {
    ciphertext: body.ciphertext,
    iv: body.iv,
    salt: body.salt,
    updatedAt,
  };
  await env.DRAFTS.put(`draft:${owner}:${name}`, JSON.stringify(draftObj));
  // 更新 index
  const idxKey = `owner:${owner}:index`;
  const idxRaw = await env.DRAFTS.get(idxKey);
  let names: string[] = [];
  if (idxRaw) {
    try {
      const parsed = JSON.parse(idxRaw);
      if (Array.isArray(parsed?.names)) names = parsed.names.filter((x: unknown) => typeof x === "string");
    } catch { /* ignore */ }
  }
  if (!names.includes(name)) {
    names.push(name);
    await env.DRAFTS.put(idxKey, JSON.stringify({ names }));
  }
  return jsonResponse(request, { ok: true, updatedAt });
}

async function handleDeleteDraft(request: Request, env: Env, url: URL): Promise<Response> {
  const owner = validateOwner(url.searchParams.get("owner"));
  const name = validateName(url.searchParams.get("name"));
  if (!owner) return badRequest(request, "invalid owner");
  if (!name) return badRequest(request, "invalid name");
  await env.DRAFTS.delete(`draft:${owner}:${name}`);
  // 更新 index
  const idxKey = `owner:${owner}:index`;
  const idxRaw = await env.DRAFTS.get(idxKey);
  if (idxRaw) {
    try {
      const parsed = JSON.parse(idxRaw);
      if (Array.isArray(parsed?.names)) {
        const names = parsed.names.filter((x: unknown) => typeof x === "string" && x !== name);
        if (names.length === 0) {
          await env.DRAFTS.delete(idxKey);
        } else {
          await env.DRAFTS.put(idxKey, JSON.stringify({ names }));
        }
      }
    } catch { /* ignore */ }
  }
  return jsonResponse(request, { ok: true });
}

// ---- entry ----

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    // 健康检查
    if (url.pathname === "/" || url.pathname === "/health") {
      return jsonResponse(request, {
        ok: true,
        service: "gpt-draft",
        version: "0.1.0",
      });
    }

    // Rate limit(先扣桶)
    const rlOk = await checkRateLimit(env, request);
    if (!rlOk) return rateLimited(request);

    try {
      if (url.pathname === "/list") {
        if (request.method === "GET") return handleList(request, env, url);
        return methodNotAllowed(request);
      }
      if (url.pathname === "/draft") {
        if (request.method === "GET") return handleGetDraft(request, env, url);
        if (request.method === "PUT") return handlePutDraft(request, env, url);
        if (request.method === "DELETE") return handleDeleteDraft(request, env, url);
        return methodNotAllowed(request);
      }
      return notFound(request, "unknown route");
    } catch (err) {
      console.error("worker error", err);
      return serverError(request, "internal error");
    }
  },
};
