# Complement OpenClaw's built-in security, don't replace it

Date: 2026-03-15
Status: decided (validated against source code)

## Context

OpenClaw has a **distributed security model** with multiple independent subsystems — confirmed from source code exploration. There is no single "security module." The components are:

| Component | What It Does | Source File |
|-----------|-------------|-------------|
| **Exec approvals** | Shell command allowlist/ask/deny, pattern-based approval, 120s timeout | `src/infra/exec-approvals.ts` |
| **Tool profiles** | Four levels (minimal → coding → messaging → full) with per-agent allow/deny | `src/agents/tool-policy.ts` |
| **Tool catalog** | 30 core tools in 11 sections, owner-only filtering | `src/agents/tool-catalog.ts` |
| **Prompt injection detection** | 13 regex patterns, Unicode normalization, boundary markers | `src/security/external-content.ts` |
| **Security audit CLI** | `openclaw security audit --deep` — comprehensive posture scan | `src/security/audit.ts` |
| **Auth rate limiting** | Sliding window (10 fails → 5min lockout), per-scope | `src/gateway/auth-rate-limit.ts` |

The trust model (from `SECURITY.md`): one trusted operator per gateway, host is the trusted boundary, authenticated callers are treated as operators, plugins run in-process with gateway privileges.

When building ClawClip, we had to decide: do we compete with these built-in components, or complement them?

## Decision

**Complement OpenClaw's built-in security.** ClawClip layers user-facing guardrails on top of the system-level security that OpenClaw already provides. We do not duplicate, replace, or bypass any built-in security functionality.

## Rationale

### Built-in security is good at what it does

- **Exec approvals** handle shell command safety with a mature allowlist/ask model — we don't need to reinvent this
- **Tool profiles** provide developer-level access control (minimal → full) — proper access control, not our domain
- **Prompt injection detection** uses 13 regex patterns + Unicode normalization + boundary markers — deep content-safety integration we can't match from a plugin
- **Auth rate limiting** handles gateway security with sliding windows — infrastructure concern
- **Security audit CLI** provides comprehensive posture scanning — we'd never match this depth

### Our value is different

- Built-in security is a **firewall** — automated, binary (allow/deny), operator-configured
- ClawClip is **parental controls** — human-in-the-loop, nuanced (allow/deny/ask), user-configured
- These are complementary, not competitive
- Users need both: "I trust that exec approvals keep dangerous commands in check, AND I want ClawClip to ask me before sending emails"

### Competing with built-in security would be a losing strategy

- OpenClaw could change their security internals at any time, breaking our reimplementation
- The OpenClaw community would see us as adversarial
- We'd spend engineering time on solved problems instead of our unique features
- Users would have to choose between built-in security and ClawClip — fragmented security is worse than layered security

## Implementation

1. ClawClip registers `before_tool_call` at **priority 100** — runs early but operates in the plugin hook layer
2. Built-in exec approvals and tool profile checks run in the **tool execution pipeline** (after hooks) — they're not plugin hooks, they're runtime enforcement
3. If built-in security blocks an action (e.g., exec not in allowlist), it happens after/alongside ClawClip's hook — both layers contribute
4. ClawClip only evaluates actions against **user-defined business-logic rules** — "should this happen?" not "is this technically permitted?"
5. ClawClip's YAML policy format is separate from built-in security config — different audiences, different needs
6. ClawClip never modifies built-in security config or overrides its decisions

```
                Built-in says       ClawClip says     Result
Action A:       ALLOW (in profile)  ALLOW (policy)    Proceeds
Action B:       ALLOW (in profile)  BLOCK (policy)    Blocked (by ClawClip)
Action C:       ALLOW (in profile)  APPROVE?          User prompted
Action D:       BLOCK (not in       (hook fires but   Blocked (by built-in)
                profile / exec      tool never
                denied)             executes)
```

## Tradeoff

We can't provide a "single pane of glass" for all security in v0.1. Users who want to understand why something was blocked may need to check both OpenClaw's JSONL logs (`/tmp/openclaw/openclaw-YYYY-MM-DD.log`) and ClawClip's audit log. In v0.2, we may integrate with OpenClaw's logging to provide a unified view.

## Messaging

When describing ClawClip:
- **Do say:** "ClawClip adds human-in-the-loop approval on top of OpenClaw's exec approvals, tool profiles, and prompt injection detection"
- **Don't say:** "ClawClip replaces OpenClaw's security with better security"
- **Analogy:** "Built-in security is the firewall, ClawClip is the parental controls"

## See Also

- [[openclaw-security]] — full breakdown of all built-in security components
- [[research/competitors]] — competitive positioning including built-in security
- [[product/vision]] — positioning relative to built-in security
