---
name: prism-long-task-survival
description: "Recognize and route around Prism gateway's 7-12 min SSE stream cutoff when running long Claude tasks. Covers the chunking SOP, known dead-ends, and the proven primary route: offload long browser/工程 work to an isolated OpenClaw subagent (with spawn-survival, gateway-scope workarounds, and verify-before-deliver steps)."
---

# Surviving long tasks on Prism

Prism (the team's `https://copilot.xchunzhao.top` Claude gateway) silently kills SSE streams in the **7-12 minute window** for sonnet, ~90 s for opus 4.7. Two rounds of PoC (May 2026, `~/.openclaw/workspace/projects/marvis-infra/acp-prism-poc/`) proved this is server-side and **not fixable by any client-side knob**.

## When to read this

- You're about to run a Claude task on Prism whose total time (thinking + output) might exceed ~6 min
- Marvis / CC just reported "Stream idle timeout - partial response received" or "socket connection was closed unexpectedly"
- The agent silently stopped streaming, TCP still ESTABLISHED, last chunk was mid-sentence
- You're writing a new LLM client that targets `copilot.xchunzhao.top` and want to skip the obvious traps
- Someone (彦祖) suggests "just bump the CC timeout" — **read §"Dead ends" before agreeing**
- **The main session keeps dying mid-reply / the user has to resend** when you run a long task (big spawn, multi-min exec, gateway restart) — read §"Escape hatch" for why and the isolated-subagent SOP
- You're about to run a **long browser scrape / multi-page generation / 工程 task** and want the proven pattern that doesn't get cut

## What's actually broken

- The break is at Prism's gateway layer, not at Anthropic, not at CC, not at the ACP bridge.
- Fail-fast variant: `API Error: The socket connection was closed unexpectedly` from `fetch` / Anthropic SDK.
- Fail-slow variant (more common): TCP stays ESTABLISHED, no data arrives, no error. Client hangs forever unless something has a timer.
- The cutoff window is consistent across: CC TUI, `claude-agent-acp` bridge, custom Python ACP client, with or without `API_TIMEOUT_MS` set to 20 min.
- Model never gets to call its Write tool — both PoCs died mid-`thinking` stream, zero user-facing text emitted, zero file written.

## SOP — chunking (only known thing that works today)

1. **Cap single Prism request at ~5 min wall time.** Includes extended-thinking. Leave 30% margin under the 7-min lower bound.
2. **Cap single output at ~300 lines** of user-facing text. Empirically this stays inside the safe window even for sonnet's verbose modes.
3. **Split big work into N small turns.** Pattern: outline first (1 turn), then one section per turn, with explicit "you only output section K, stop". Each turn re-establishes a fresh stream.
4. **Persist intermediate state in files**, not in conversation. Each turn reads what previous turns wrote, appends its piece, writes back. Recovery is then a re-run of one chunk, not the whole task.
5. **For tasks that genuinely can't be chunked** (one big file ≥2k lines, one big SVG): don't use Prism. Use the OpenClaw subagent escape hatch (see below) or escalate to K师 to get an Anthropic-direct token.

## Failure signals — recognize these fast

- `socket connection was closed unexpectedly` in any layer's stderr → Prism stream cut, period.
- CC TUI red banner "Stream idle timeout - partial response received" → same thing.
- Stream silently stops mid-sentence, no error, TCP `ESTABLISHED` per `lsof -p <pid> -i` → fail-slow variant, kill manually.
- Sentence in the last chunk ends with an unfinished word like "—with" or "transaction" instead of a period → diagnostic of stream truncation, not model finishing.

## Dead ends — do NOT try these

These have been tested or analyzed and **do not work**:

- ❌ `API_TIMEOUT_MS=1200000` on the CC env (彦祖's suggestion). Verified May 2026 round 2: stream still died at t=10:15 with the var set, the var doesn't govern SSE idle, only request total. See `acp-prism-poc/round2/report.md`.
- ❌ Swapping CC TUI for `@agentclientprotocol/claude-agent-acp` bridge. Verified round 1: same break, same window.
- ❌ Writing a custom Python ACP client to bypass CC. Round 1 did this; broke identically.
- ❌ Setting bigger `MAX_THINKING_TOKENS`. Doesn't help, thinking is what blows the budget.
- ❌ Bumping CC's `--max-turns`. Per-turn break is the problem.
- ❌ Switching to opus 4.7 hoping it'd be faster. Opus breaks ~90 s on Prism per K师 reports; far worse than sonnet.

## Escape hatch — OpenClaw subagent (the proven primary route)

OpenClaw's `subagent` capability runs on a different LLM path that is **not Prism**, and a spawned subagent runs in its **own isolated session** — its tool calls and streaming do NOT flow through the main session's SSE stream. This is now the **default route for any long task**, not just a last resort. Verified end-to-end 2026-06-04 on a 20-min browser-scrape + rebuild job (GreenDeal API docs, 35 pages).

- Hand it off to a subagent with explicit task scope.
- Don't pipe Prism's output through OpenClaw — use OpenClaw's own model.
- This burns the budget on a different provider; check with the user first if cost matters.

### Why the main session keeps getting cut (the real failure mode, 2026-06-04)

The symptom users see is **"the agent stopped mid-reply / I had to resend my message."** Root cause: when the **main session** makes a long-running tool call (a big `sessions_spawn`, a `gateway` restart, a multi-minute `exec`), that tool round-trip holds the main SSE stream open past Prism's cutoff window → the stream dies → the turn aborts with `[assistant turn failed before producing content]` and the spawn/op may **never actually land**.

Observed twice the same day: two `sessions_spawn` calls and a `gateway` op all died this way. `subagents list` showed **empty** afterward — the spawn was eaten by the cut, no child existed. **Always verify the child actually spawned (`subagents list` / check `status: accepted`) before assuming work is running.**

### SOP — running a long browser/工程 task via isolated subagent

1. **Don't do the long work in the main session.** No long browser loops, no multi-minute exec, no giant inline generation in the main turn. The main session's job is: write a tight brief → `sessions_spawn` → `sessions_yield` → wait for the push completion event.
2. **Spawn with a complete, self-contained task brief.** The child has a fresh context — give it: data sources (file paths), the exact steps, the output path, the content rules ("don't fabricate"), and a "report back" spec. A vague brief = a child that drifts.
3. **Persist scraped/intermediate data to a file inside the child** (e.g. `assets/*_scrape.md`) before generating the final artifact. Then a re-run regenerates from the saved data instead of re-scraping. Reuse that file across follow-up tasks (the Figma-export task reused the scrape file — no re-scrape).
4. **`sessions_yield` immediately after spawning.** Do NOT poll `subagents`/`sessions_list` in a loop. Completion is push-based and arrives as a user message.
5. **Verify the child's output yourself before reporting success.** The child reports rosy; you check: `ls` the files, `wc -l`, `grep` for the expected page count / zero external deps, and look at the self-check screenshots with the `image` tool. Don't forward a child's self-praise as delivery.
6. **Confirm the spawn landed.** If the spawn call itself was cut (see failure mode above), `subagents list` is empty — re-spawn. Don't assume.

### Inside the child: gateway-scope dead-ends

- The CLI `browser` tool may be **unavailable inside a subagent** if the gateway device scope isn't approved (`operator.write` pending). Don't block on it.
- **Workaround that works:** have the child use **Playwright + bundled Chromium headless** directly (not the gateway browser tool). Same rendering result for JS-rendered SPAs, no gateway dependency. The 35-page scrape used this after the gateway browser tool was scope-blocked.

### Anti-pattern — don't restart the gateway from inside a cron/turn that needs to survive the restart

A one-shot cron whose job is `launchctl kickstart` the gateway will **kill its own executing process** mid-run ("job interrupted by gateway restart"). The restart lands but the report step never runs. If you must restart, do it from a plain `exec` and verify state afterward in a separate step — don't wrap the self-restart in the same cron/turn that's supposed to report the result.

## For anyone writing a new LLM client on Prism

- Set a **client-side idle timeout** on the SSE stream (e.g. 90 s no data → kill + retry the chunk). Don't trust the server to error out.
- Implement **chunk-level retries**, not request-level. A failed chunk should resume from the last persisted state, not restart from scratch.
- Build the chunking into the abstraction. Don't expose "send one giant prompt" as a viable API.
- Log every byte-of-stream timestamp; without that you can't tell fail-fast from fail-slow.

## Asking Prism owners for a real fix

If escalating to whoever runs `copilot.xchunzhao.top`, the ask is concrete:

- Their gateway (nginx / Caddy / Cloudflare / Bun) has a `proxy_read_timeout` / max-request-duration around **600 s for sonnet, 90 s for opus**. Need this bumped to ≥1800 s.
- Or: enable HTTP/2 long-lived stream pass-through with keepalive PING.
- Or: provision a path that bypasses the gateway and goes Anthropic-direct for Marvis-team tokens.

Evidence to attach: `acp-prism-poc/report.md` (round 1) + `acp-prism-poc/round2/report.md` + the r1 stderr trace showing `socket connection was closed unexpectedly`.

## References

- Round 1 PoC: `~/.openclaw/workspace/projects/marvis-infra/acp-prism-poc/report.md`
- Round 2 PoC: `~/.openclaw/workspace/projects/marvis-infra/acp-prism-poc/round2/report.md`
- CC env reverse-engineering: `~/.openclaw/workspace/projects/marvis-infra/acp-prism-poc/round2/timeout-config-research.md`
- GitHub issue on CC stream timeouts (for context, not a fix): https://github.com/anthropics/claude-code/issues/5615
