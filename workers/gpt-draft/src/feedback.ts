/**
 * MVS-010 · feedback ticket helpers (pure functions, unit-testable)
 * ----------------------------------------------------------------
 * 这些函数刻意与 Cloudflare Worker runtime 解耦：
 *   - 生成随机字节由 caller 注入(测试可传伪 RNG)
 *   - KV 读写在 caller 一层,内部只做校验/格式化
 * 目的：node:test 里可以直接跑,不依赖 miniflare。
 */

export const FEEDBACK_PRODUCT_WHITELIST = ["mvs-010", "mvs-013"] as const;
export type FeedbackProduct = typeof FEEDBACK_PRODUCT_WHITELIST[number];

export const FEEDBACK_LIMITS = {
  contentMin: 1,
  contentMax: 500,
  versionMax: 32,
  contactMax: 100,
  uaMax: 200,
  perMinute: 2,
  perDay: 20,
};

export interface FeedbackInput {
  product?: unknown;
  version?: unknown;
  content?: unknown;
  contact?: unknown;
  ua?: unknown;
}

export interface FeedbackClean {
  product: FeedbackProduct;
  version: string;
  content: string;
  contact: string;
  ua: string;
}

export type FeedbackValidateResult =
  | { ok: true; value: FeedbackClean }
  | { ok: false; error: string };

/** 请求体校验：白名单 + 长度 + 类型 */
export function validateFeedbackBody(body: FeedbackInput | null | undefined): FeedbackValidateResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body must be JSON object" };
  }
  const product = body.product;
  if (typeof product !== "string" || !(FEEDBACK_PRODUCT_WHITELIST as readonly string[]).includes(product)) {
    return { ok: false, error: "invalid product" };
  }
  const content = body.content;
  if (typeof content !== "string") return { ok: false, error: "content required" };
  const contentTrim = content.trim();
  if (contentTrim.length < FEEDBACK_LIMITS.contentMin) return { ok: false, error: "content required" };
  if (contentTrim.length > FEEDBACK_LIMITS.contentMax) return { ok: false, error: "content too long" };

  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (version.length > FEEDBACK_LIMITS.versionMax) return { ok: false, error: "version too long" };

  const contact = typeof body.contact === "string" ? body.contact.trim() : "";
  if (contact.length > FEEDBACK_LIMITS.contactMax) return { ok: false, error: "contact too long" };

  const ua = typeof body.ua === "string" ? body.ua.trim() : "";
  if (ua.length > FEEDBACK_LIMITS.uaMax) return { ok: false, error: "ua too long" };

  return {
    ok: true,
    value: {
      product: product as FeedbackProduct,
      version,
      content: contentTrim,
      contact,
      ua,
    },
  };
}

/** 4 位大写 HEX 工单号；接收注入的随机字节获取器，方便测试。 */
export function generateTicketId(getRandomBytes: (n: number) => Uint8Array): string {
  const bytes = getRandomBytes(2);
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16).padStart(2, "0");
    s += h;
  }
  return s.toUpperCase();
}

/** HTML 转义：Telegram parse_mode=HTML 只需要转 & < >(见官方文档)。 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/** yyyymm 月份索引 key */
export function monthBucket(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

/** yyyymmdd（UTC+8）日桶 —— 用 UTC+8 让"每天 20 条"符合国人直觉 */
export function dayBucketCN(ts: number): string {
  const shifted = new Date(ts + 8 * 3600 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** 分钟桶(UTC epoch minute) */
export function minuteBucket(ts: number): number {
  return Math.floor(ts / 60_000);
}

/** UTC+8 展示时间 "2026-08-03 15:40 (UTC+8)" */
export function formatCNTime(ts: number): string {
  const shifted = new Date(ts + 8 * 3600 * 1000);
  const y = shifted.getUTCFullYear();
  const M = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const D = String(shifted.getUTCDate()).padStart(2, "0");
  const h = String(shifted.getUTCHours()).padStart(2, "0");
  const m = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${y}-${M}-${D} ${h}:${m} (UTC+8)`;
}

export interface TgMessageParts {
  ticketId: string;
  product: string;
  version: string;
  content: string;
  contact: string;
  ua: string;
  ts: number;
}

/** 组装 Telegram HTML 消息(所有用户输入都转义) */
export function buildTelegramMessage(p: TgMessageParts): string {
  const header =
    `🎫 <b>#${escapeHtml(p.ticketId)}</b> · ${escapeHtml(p.product)}` +
    (p.version ? ` ${escapeHtml(p.version)}` : "");
  const bar = "━━━━━━━━━━━━━";
  const lines: string[] = [];
  lines.push(header);
  lines.push(bar);
  lines.push(escapeHtml(p.content));
  lines.push(bar);
  if (p.contact) lines.push(`📮 ${escapeHtml(p.contact)}`);
  lines.push(`🕐 ${formatCNTime(p.ts)}`);
  if (p.ua) lines.push(`🌐 ${escapeHtml(p.ua)}`);
  return lines.join("\n");
}
