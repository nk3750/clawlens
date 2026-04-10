# ADR-007: LLM Evaluation Key Resolution Failures

> Date: 2026-04-07
> Status: **Resolved** (2026-04-09)
> Severity: P1 — intermittent silent degradation of AI risk evaluations
> Resolution: Replaced all 3 eval paths. See `docs/architecture/fix-llm-eval-resolution.md`

## Problem

LLM evaluations fail intermittently. In a session with N tool calls needing eval, some get AI evaluations and others silently fall back to stubs ("AI assessment unavailable"). The failure rate worsens for cron-triggered agents.

## Symptom

Session `agent:social-manager:cron:trend-scan-tweet-006#32`: 2 tool calls received LLM evaluations, 3rd failed. Dashboard shows "AI assessment unavailable" for the failed entry.

## Root Cause Analysis

### The 3-path eval cascade

`evaluateWithLlm()` in `src/risk/llm-evaluator.ts` tries three paths in order:

| Path | Mechanism | Failure mode |
|------|-----------|-------------|
| 1. modelAuth | `runtime.modelAuth.resolveApiKeyForProvider(provider)` → direct API call | Returns `undefined`, SDK calls `.trim()` on it → crash |
| 2. env var | `process.env[ANTHROPIC_API_KEY]` → direct API call | Variable not in LaunchAgent environment |
| 3. subagent | `runtime.subagent.run()` → gateway spawns LLM call | Request-scoped — only works during active gateway request |

**All three paths fail**, but Path 3 sometimes succeeds — creating the intermittent behavior.

### Path 1: modelAuth — gateway SDK bug

The OpenClaw auth config (`~/.openclaw/openclaw.json`) has:
```json
"auth": {
  "profiles": {
    "anthropic:claw": {
      "provider": "anthropic",
      "mode": "api_key"
    }
  }
}
```

The profile declares `mode: "api_key"` but the actual key is stored in the gateway's secure store (macOS Keychain). `resolveApiKeyForProvider("anthropic")` is supposed to retrieve it but returns `undefined`. The SDK then calls `.trim()` on the result internally, producing:

```
Cannot read properties of undefined (reading 'trim')
```

This is a **gateway SDK bug** — `resolveApiKeyForProvider` should either return the key or throw a meaningful error, not return undefined to its own `.trim()` call. The `ModelAuth` TypeScript interface in `src/types.ts:66` declares `Promise<string>` but the implementation returns `Promise<string | undefined>`.

**modelAuth has never succeeded in this setup.** Every invocation in the logs throws.

### Path 2: env var — LaunchAgent doesn't inherit shell env

`ANTHROPIC_API_KEY` exists in the user's shell (`~/.zshrc`) but the gateway runs as macOS LaunchAgent `ai.openclaw.gateway`. LaunchAgents do not inherit shell environment variables — they only see variables explicitly set in the plist `EnvironmentVariables` dict or `launchctl setenv`. The plist has no `EnvironmentVariables` section.

### Path 3: subagent — request-scoped, eval is fire-and-forget

The `before_tool_call` handler (`src/hooks/before-tool-call.ts:124`) calls `evaluateWithLlm()` with `.then()` chaining — **it does not await**. The eval runs as a detached promise after the hook returns.

The subagent runtime (`runtime.subagent`) is request-scoped — it is only valid during the lifecycle of an active gateway request. Whether Path 3 succeeds is a **race condition**:

- The eval promise starts executing while the hook is still in the request pipeline
- Path 1 fails (modelAuth throws, ~1ms)
- Path 2 fails (env var check, ~0ms)
- Path 3 calls `subagent.run()` — if the gateway request is still alive, this works

**Why 2 pass and the 3rd fails:**

During an agent turn, the gateway issues multiple tool calls. Each spawns a detached eval promise. The first two promises reach `subagent.run()` fast enough — their Path 1/2 failures are quick, the gateway request is still processing subsequent tool calls. The third promise's `subagent.run()` call lands **after the agent's turn completes** and the request context is torn down:

```
17:10:40.944  eval 1 starts → Path 1 fail → Path 2 fail → Path 3 succeeds (request alive)
17:10:40.970  eval 2 starts → Path 1 fail → Path 2 fail → Path 3 succeeds (request alive)
17:10:47.023  eval 3 reaches Path 3 → "only available during gateway request" (request ended)
17:10:47.023  All eval paths exhausted, returning stub
```

The 7-second gap is the time Path 1 and Path 2 took to fail for eval 3, during which the request completed.

### Contributing factors

**Duplicate handler registration.** `register()` is called per-session by the gateway. Each call creates a new `before_tool_call` handler via `api.on()` (`index.ts:78`). The same tool call triggers eval from multiple handlers — confirmed by paired log entries at the same millisecond (e.g., `20:01:16.121` and `20:01:16.132`).

**Eval cache masks the failure rate.** The `EvalCache` (`src/risk/eval-cache.ts`) caches high-confidence evaluations. Common patterns (health checks, read-only ops) hit cache and skip the LLM entirely (`before-tool-call.ts:102-121`). The cache is pre-warmed from audit logs at startup. This makes the failure appear less frequent than it is — only novel/high-risk patterns actually attempt the LLM.

**Cron agents are worst-hit.** Cron-triggered runs have shorter request lifetimes than interactive sessions. The subagent window is narrower, making the race condition more likely.

**No error surfacing.** All failures are caught silently — the `.catch()` at `before-tool-call.ts:178` logs a warning and writes a stub audit entry. The dashboard shows "AI assessment unavailable" but nothing alerts the operator that evals are systematically failing.

## Fix Options

### Option 1: Fix modelAuth upstream (correct fix, external dependency)

The gateway SDK's `resolveApiKeyForProvider` should return the key from the macOS Keychain secure store. The auth profile exists and agents use the key successfully — the resolution path is broken specifically for the plugin modelAuth interface.

**Impact:** Fixes Path 1 for all providers. Direct `callLlmApi` via `fetch()` has no request-scoping issues, works async.
**Blocker:** Requires a fix in the OpenClaw gateway SDK. Outside our control.

### Option 2: Await eval within the request (architectural change)

Make `evaluateWithLlm()` awaited instead of fire-and-forget. This keeps Path 3 (subagent) inside the request window.

**Impact:** Path 3 always works for any provider. No key management needed.
**Cost:** 1-2s latency for tool calls exceeding `llmEvalThreshold` (currently 50). Low-risk calls are unaffected.
**Prerequisite:** Gateway must support async `before_tool_call` handlers (returns `Promise<BeforeToolCallResult>`). Current handler signature is synchronous.

### Option 3: Add ANTHROPIC_API_KEY to LaunchAgent plist (operational fix)

Add the key to `~/Library/LaunchAgents/ai.openclaw.gateway.plist` under `EnvironmentVariables`.

**Impact:** Fixes Path 2 immediately. Direct `fetch()`, no request-scoping.
**Downside:** Provider-specific (hardcoded to Anthropic). Must be repeated for each provider. Key in plaintext in plist file.

### Option 4: Plugin-level key file (plugin-managed fix)

Plugin reads API key from a file (e.g., `~/.openclaw/plugins/clawlens/api-key`) at startup. Provider-agnostic — file contains `PROVIDER=anthropic` and `API_KEY=sk-ant-...`.

**Impact:** Fixes Path 2 for any provider. No plist changes. Plugin controls its own auth.
**Downside:** Requires manual key placement. Separate key management from gateway's auth system.

### Option 5: Guard modelAuth + defensive coding (partial, code-level)

- Check `resolveApiKeyForProvider` return for `undefined` before use
- Fix `ModelAuth` type to `Promise<string | undefined>`
- Skip Path 3 for fire-and-forget evals (it's architecturally incompatible)
- Guard against duplicate handler registration in `index.ts`

**Impact:** Cleaner failure logging, prevents wasted subagent attempts. Does NOT fix the actual eval — just makes failure faster and more visible.

## Recommendation

**Short-term:** Option 3 (env var in plist) to unblock evals immediately, combined with Option 5 (defensive guards) to prevent wasted work and duplicate handlers.

**Medium-term:** Option 2 (await eval) if async handlers are supported, or Option 4 (key file) as a self-contained fallback.

**Long-term:** Option 1 (fix modelAuth upstream) — this is what the SDK interface was designed for.

## Resolution (2026-04-09)

None of the original 5 options were implemented. Investigation revealed two deeper root causes that the original analysis missed:

1. **ClawLens's `ModelAuth` type was wrong.** The SDK expects `resolveApiKeyForProvider({ provider, cfg })` (object parameter) and returns `ResolvedProviderAuth` (object with `.apiKey`). ClawLens was passing a bare string and treating the return as a string. This is why `.trim()` crashed — the SDK couldn't destructure a bare string.

2. **The intended plugin LLM mechanism is `runtime.agent.runEmbeddedPiAgent()`**, not subagent or manual API calls. This is what OpenClaw's own first-party `llm-task` plugin uses. It handles auth resolution internally through the gateway's config and is not request-scoped.

The fix replaced all 3 original eval paths with a new cascade:
- **Path 1:** `runEmbeddedPiAgent()` — handles auth internally, works everywhere
- **Path 2:** `modelAuth` with corrected object-param signature — direct `fetch()` fallback
- **Path 3:** Env var fallback (unchanged)

The subagent path was removed entirely — it is architecturally incompatible with plugin hooks.

See `docs/architecture/fix-llm-eval-resolution.md` for the full fix document.

## Files Referenced

| File | Relevance |
|------|-----------|
| `src/risk/llm-evaluator.ts` | 3-path eval cascade (lines 241-363) |
| `src/hooks/before-tool-call.ts` | Fire-and-forget eval trigger (line 124), duplicate handler risk |
| `index.ts` | Runtime capture at registration (line 63), handler wiring (line 78) |
| `src/risk/eval-cache.ts` | Cache masks failure rate |
| `src/types.ts:65-68` | `ModelAuth` interface — type declaration wrong |
| `src/config.ts` | `llmApiKeyEnv` defaults to `ANTHROPIC_API_KEY` |
| `~/.openclaw/openclaw.json` | Auth profile config, provider detection |
