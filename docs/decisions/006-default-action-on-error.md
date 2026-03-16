# Default ClawClip behavior on error

Date: 2026-03-16
Status: open

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

Not yet decided. Options below.

## Options

**A — Fail closed (block)**
When uncertain, block the tool call and surface an error to the user.
- Pro: Safest default — guardrails never silently bypass themselves
- Con: A policy typo or slow response halts legitimate agent work

**B — Fail open (allow)**
When uncertain, allow the tool call and log the error loudly.
- Pro: Agent keeps running; visibility through logs
- Con: Silently bypasses the guardrail on any error — defeats the purpose

**C — Fallback to last known-good policy**
On parse failure, revert to the most recently loaded valid policy state.
- Pro: Handles typos gracefully without blocking
- Con: Requires policy versioning; doesn't address approval timeout

**D — Configurable per rule**
Each policy rule declares its own fallback: `on_error: block` or `on_error: allow`.
- Pro: Maximum flexibility; power users can tune per-tool risk tolerance
- Con: Adds schema complexity before v0.1 ships; creates inconsistent user experience

## Tradeoff

Options A and B are the clearest expression of the product's stance on safety vs.
usability. C and D are more nuanced but carry implementation cost. 

## See Also

- [[architecture/clawclip-hook-strategy]] — before_tool_call hook execution model
- [[architecture/policy-engine]] — policy evaluation algorithm and rate limit tracking
- [[product/mvp-scope]] — human-in-the-loop approval as P0 feature
