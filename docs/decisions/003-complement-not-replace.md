# Complement OpenClaw's built-in security, don't replace it

Date: 2026-03-15
Status: decided

## Context

OpenClaw has some form of built-in security system. We don't yet know exactly what it's called, how it works, or the full scope of what it covers. Based on documentation and general expectations, we assume it handles some combination of permission enforcement, threat detection, and sandboxing. See [[openclaw-security]] for what we learn as we explore.

When building ClawClip, we had to decide: do we compete with OpenClaw's built-in security (replace its functionality with our own), or complement it (build a user-facing layer on top)?

## Decision

**Complement OpenClaw's built-in security.** ClawClip layers user-facing guardrails on top of whatever system-level security OpenClaw provides. We do not duplicate, replace, or bypass any built-in security functionality.

## Rationale

### Built-in security is likely good at what it does
- System-level permission enforcement is hard to build and harder to get right
- Threat detection (prompt injection, data exfiltration) requires deep integration with the runtime
- Sandboxing needs OS-level primitives — not something a plugin should reimplement
- The OpenClaw team maintains and updates their security with the platform — we'd always be playing catch-up

### Our value is different
- OpenClaw's security is likely a **firewall** — automated, binary (allow/deny), system-administered
- ClawClip is **parental controls** — human-in-the-loop, nuanced (allow/deny/ask), user-configured
- These are complementary, not competitive
- Users need both: "I trust that built-in security keeps me safe from malware, AND I want ClawClip to ask me before sending emails"

### Competing with built-in security would be a losing strategy
- OpenClaw could change their security internals at any time, breaking our reimplementation
- The OpenClaw community would see us as adversarial ("why are you replacing our security?")
- We'd spend engineering time on solved problems instead of our unique features
- Users would have to choose between built-in security and ClawClip — fragmented security is worse than layered security

> **Note:** This reasoning is based on assumptions about what OpenClaw's security does. We need to verify hands-on when the Mac Mini arrives. The strategic direction (complement, don't replace) holds regardless of the specifics.

## Implementation

1. ClawClip registers hooks at a lower priority than built-in security (e.g., priority 10 if built-in runs at priority 0 — needs verification)
2. If built-in security blocks an action, ClawClip should never see it — correct behavior
3. ClawClip only evaluates actions that are **technically permitted** but may need **business-logic review**
4. ClawClip's policy format is separate from built-in security — different audiences, different needs
5. ClawClip never modifies built-in security config or overrides its decisions

```
                Built-in says   ClawClip says     Result
Action A:       ALLOW           ALLOW             Proceeds
Action B:       ALLOW           BLOCK             Blocked (by ClawClip)
Action C:       ALLOW           APPROVE?          User prompted
Action D:       BLOCK           (never sees it)   Blocked (by built-in)
```

## Tradeoff

We can't provide a "single pane of glass" for all security in v0.1. Users who want to understand why something was blocked may need to check both built-in security logs and ClawClip logs. In v0.2, we may integrate with OpenClaw's audit log to give users a unified view.

## Messaging

When describing ClawClip:
- **Do say:** "ClawClip adds human-in-the-loop approval on top of OpenClaw's built-in security"
- **Don't say:** "ClawClip replaces OpenClaw's security with better security"
- **Analogy (hypothesis):** "Built-in security is the firewall, ClawClip is the parental controls"

## See Also

- [[openclaw-security]] — what OpenClaw's built-in security does and doesn't do
- [[research/competitors]] — built-in security as internal competitor analysis
- [[product/vision]] — positioning relative to built-in security
