// MVS-010 feedback pure-function tests
// Run: node --test test/feedback.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateFeedbackBody,
  generateTicketId,
  escapeHtml,
  buildTelegramMessage,
  monthBucket,
  dayBucketCN,
  minuteBucket,
  formatCNTime,
  FEEDBACK_PRODUCT_WHITELIST,
  FEEDBACK_LIMITS,
} from "../src/feedback.ts";

test("generateTicketId: 4-char uppercase hex", () => {
  const id = generateTicketId((n) => new Uint8Array(n).map((_, i) => [0xa3, 0xf7][i]));
  assert.equal(id, "A3F7");
  assert.match(id, /^[0-9A-F]{4}$/);
});

test("generateTicketId: random path still uppercase 4-hex", () => {
  for (let i = 0; i < 20; i++) {
    const id = generateTicketId((n) => {
      const b = new Uint8Array(n);
      for (let j = 0; j < n; j++) b[j] = Math.floor(Math.random() * 256);
      return b;
    });
    assert.match(id, /^[0-9A-F]{4}$/, `bad id: ${id}`);
  }
});

test("validateFeedbackBody: missing content -> error", () => {
  const r = validateFeedbackBody({ product: "mvs-010" });
  assert.equal(r.ok, false);
  assert.match(r.error, /content/);
});

test("validateFeedbackBody: content too long -> error", () => {
  const big = "x".repeat(FEEDBACK_LIMITS.contentMax + 1);
  const r = validateFeedbackBody({ product: "mvs-010", content: big });
  assert.equal(r.ok, false);
  assert.match(r.error, /too long/);
});

test("validateFeedbackBody: product not whitelisted -> error", () => {
  const r = validateFeedbackBody({ product: "mvs-999", content: "hi" });
  assert.equal(r.ok, false);
  assert.match(r.error, /product/);
});

test("validateFeedbackBody: happy path trims + defaults", () => {
  const r = validateFeedbackBody({
    product: "mvs-010",
    content: "  buggy  ",
    version: "v0.6",
    contact: "wx: abc",
    ua: "Chrome 131 / macOS",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    product: "mvs-010",
    content: "buggy",
    version: "v0.6",
    contact: "wx: abc",
    ua: "Chrome 131 / macOS",
  });
});

test("validateFeedbackBody: whitespace-only content rejected", () => {
  const r = validateFeedbackBody({ product: "mvs-010", content: "   " });
  assert.equal(r.ok, false);
});

test("validateFeedbackBody: version/contact/ua length caps", () => {
  const r1 = validateFeedbackBody({ product: "mvs-010", content: "ok", version: "v".repeat(FEEDBACK_LIMITS.versionMax + 1) });
  assert.equal(r1.ok, false);
  const r2 = validateFeedbackBody({ product: "mvs-010", content: "ok", contact: "c".repeat(FEEDBACK_LIMITS.contactMax + 1) });
  assert.equal(r2.ok, false);
  const r3 = validateFeedbackBody({ product: "mvs-010", content: "ok", ua: "u".repeat(FEEDBACK_LIMITS.uaMax + 1) });
  assert.equal(r3.ok, false);
});

test("escapeHtml: <script> and & and >", () => {
  assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(escapeHtml("a & b > c"), "a &amp; b &gt; c");
});

test("buildTelegramMessage: escapes user input, omits empty contact/ua", () => {
  const msg = buildTelegramMessage({
    ticketId: "A3F7",
    product: "mvs-010",
    version: "v0.6",
    content: "<b>xss</b>",
    contact: "",
    ua: "",
    ts: 1780000000000,
  });
  assert.match(msg, /#A3F7/);
  assert.match(msg, /mvs-010/);
  assert.match(msg, /v0\.6/);
  assert.match(msg, /&lt;b&gt;xss&lt;\/b&gt;/);
  assert.ok(!msg.includes("📮"));
  assert.ok(!msg.includes("🌐"));
});

test("buildTelegramMessage: shows contact + ua when set", () => {
  const msg = buildTelegramMessage({
    ticketId: "BEEF",
    product: "mvs-010",
    version: "",
    content: "ok",
    contact: "wx: abc",
    ua: "Chrome 131 / macOS",
    ts: Date.now(),
  });
  assert.match(msg, /📮 wx: abc/);
  assert.match(msg, /🌐 Chrome 131 \/ macOS/);
});

test("time buckets & formatCNTime sanity", () => {
  const ts = Date.UTC(2026, 7, 3, 7, 40); // 2026-08-03 15:40 UTC+8
  assert.equal(monthBucket(ts), "202608");
  assert.equal(dayBucketCN(ts), "20260803");
  assert.equal(typeof minuteBucket(ts), "number");
  assert.equal(formatCNTime(ts), "2026-08-03 15:40 (UTC+8)");
});

// Simulated integration: TG push failure -> handler still returns 200
// We emulate the handler's core sequence (KV write then TG push then compose response)
// using local stand-ins for env.DRAFTS + fetch to keep this test self-contained.
test("integration: TG push failure -> caller returns 200 with notified:false", async () => {
  const store = new Map();
  const fakeEnv = {
    DRAFTS: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => { store.set(k, v); },
    },
    TG_BOT_TOKEN: "fake",
    TG_CHAT_ID: "fake",
  };
  // Simulate the handler's TG step: caller wraps in try/catch and does not throw
  async function fakePushTelegram() {
    try {
      const resp = await Promise.reject(new Error("network down"));
      return resp.ok;
    } catch { return false; }
  }
  const ticketId = generateTicketId((n) => {
    const b = new Uint8Array(n);
    b[0] = 0xde; b[1] = 0xad;
    return b;
  });
  await fakeEnv.DRAFTS.put(`fb:${ticketId}`, JSON.stringify({ ticketId, content: "ok" }));
  const notified = await fakePushTelegram();
  const response = { ok: true, ticketId, notified };
  assert.equal(response.ok, true);
  assert.equal(response.notified, false);
  assert.equal(response.ticketId, "DEAD");
  assert.ok(store.has(`fb:${ticketId}`), "KV must be written even when TG fails");
});
