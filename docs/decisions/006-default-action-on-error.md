# Default ClawClip behavior on error

Date: 2026-03-16
Status: **decided** (2026-03-29)

## Context

Two distinct scenarios can leave ClawClip unable to complete its job:

**Scenario A — Policy engine failure.** The YAML policy file is malformed, a regex
throws, or rule evaluation times out. The `before_tool_call` hook is synchronous and
blocking — if it crashes or hangs, the agent stalls.

**Scenario B — Approval timeout.** A human-in-the-loop approval was requested but
the user didn't respond within the timeout window.

Both force the same underlying question: does ClawClip block the tool call (fail closed)
or allow it (fail open)?

This plugin behavior shapes the trust contract ClawClip makes with its users.

## Decision

**A + C + D combined:** Fail closed by default, with last-known-good fallback for policy errors, and per-rule timeout configuration.

### Scenario A — Policy engine failure
- **Fail closed** (block the tool call) and surface error to user
- **Plus fallback**: If a policy file fails to parse on hot-reload, revert to the last successfully loaded policy. Log the parse error loudly. The agent keeps running under the previous good policy — not without any policy.
- This means a typo in YAML doesn't brick the agent, but a first-time load failure does block (there's no "last known good" to fall back to). This is the right tradeoff — if your first policy is broken, you should fix it before the agent runs.

### Scenario B — Approval timeout
- **Global default: deny** (block the tool call on timeout)
- **Configurable per rule** via `timeout_action: allow | deny`
- Low-risk rules can use `timeout_action: allow` for a "heads-up" notification pattern — the user is informed but the action proceeds if they don't respond. Example: approving a `web_search` where blocking would be annoying but the user still wants to know.
- High-risk rules keep `timeout_action: deny`. Example: `exec`, `message`, `write` to critical paths.

### Why this combination

The product's trust contract is: **ClawClip never silently lets something dangerous through.** Fail-closed is the only default consistent with that promise. But we add escape hatches that are explicit and auditable:
- Last-known-good prevents a policy typo from halting all agent work
- Per-rule timeout behavior lets power users reduce approval fatigue for low-risk actions
- Everything is logged — there's never a silent bypass

### Schema addition (Phase 2)

Per-rule timeout config:
```yaml
- name: "Approve web searches"
  match:
    tool: web_search
  action: approval_required
  timeout: 120
  timeout_action: allow    # heads-up pattern: allow if no response
```

For Phase 1, all timeouts use the global default (`deny`). Per-rule override ships in Phase 2.

## See Also

- [[architecture/clawclip-hook-strategy]] — before_tool_call hook execution model
- [[architecture/policy-engine]] — policy evaluation algorithm and rate limit tracking
- [[product/mvp-scope]] — human-in-the-loop approval as P0 feature
- [[product/spec]] — phased spec with timeout behavior details
