# Complement PRISM, don't replace it

Date: 2026-03-15
Status: decided

## Context

OpenClaw has a built-in security system called **PRISM** (Policy-based Runtime Interception and Security Manager). It handles permission enforcement, threat detection, sandboxing, and basic audit logging. See [[openclaw-security-prism]].

When building ClawClip, we had to decide: do we compete with PRISM (replace its functionality with our own), or complement it (build a user-facing layer on top)?

## Decision

**Complement PRISM.** ClawClip layers user-facing guardrails on top of PRISM's system-level security. We do not duplicate, replace, or bypass any PRISM functionality.

## Rationale

### PRISM is good at what it does
- Kernel-level permission enforcement is hard to build and harder to get right
- Threat detection (prompt injection, data exfiltration) requires deep integration with the runtime
- Sandboxing needs OS-level primitives — not something a plugin should reimplement
- The OpenClaw team maintains and updates PRISM with the platform — we'd always be playing catch-up

### Our value is different
- PRISM is a **firewall** — automated, binary (allow/deny), system-administered
- ClawClip is **parental controls** — human-in-the-loop, nuanced (allow/deny/ask), user-configured
- These are complementary, not competitive
- Users need both: "I trust that PRISM keeps me safe from malware, AND I want ClawClip to ask me before sending emails"

### Competing with PRISM would be a losing strategy
- OpenClaw could change PRISM internals at any time, breaking our reimplementation
- The OpenClaw community would see us as adversarial ("why are you replacing our security?")
- We'd spend engineering time on solved problems instead of our unique features
- Users would have to choose between PRISM and ClawClip — fragmented security is worse than layered security

### The malicious skills incident validates this
The early 2026 ClawHub incident (obfuscated skill exfiltrating API keys) showed that PRISM catches technical attacks, but users had no visibility. ClawClip would have added the user-facing alert layer. Both systems working together > either alone.

## Implementation

1. ClawClip registers hooks at **priority 10** (PRISM is priority 0)
2. If PRISM blocks an action, ClawClip never sees it — correct behavior
3. ClawClip only evaluates actions that are **technically permitted** but may need **business-logic review**
4. ClawClip's policy format is separate from PRISM's — different audiences, different needs
5. ClawClip never modifies PRISM config or calls PRISM APIs to override decisions

```
                PRISM says      ClawClip says     Result
Action A:       ALLOW           ALLOW             ✅ Proceeds
Action B:       ALLOW           BLOCK             ❌ Blocked (by ClawClip)
Action C:       ALLOW           APPROVE?          ⏸ User prompted
Action D:       BLOCK           (never sees it)   ❌ Blocked (by PRISM)
```

## Tradeoff

We can't provide a "single pane of glass" for all security in v0.1. Users who want to understand why something was blocked may need to check both PRISM logs and ClawClip logs. In v0.2, we may integrate with PRISM's audit log to give users a unified view.

## Messaging

When describing ClawClip:
- **Do say:** "ClawClip adds human-in-the-loop approval on top of OpenClaw's built-in security"
- **Don't say:** "ClawClip replaces OpenClaw's security with better security"
- **Analogy:** "PRISM is the firewall, ClawClip is the parental controls"

## See Also

- [[openclaw-security-prism]] — what PRISM does and doesn't do
- [[research/competitors]] — PRISM as internal competitor analysis
- [[product/vision]] — PRISM-aware positioning
