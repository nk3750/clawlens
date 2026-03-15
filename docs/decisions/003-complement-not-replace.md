# Complement OpenClaw's built-in security, don't replace it

Date: 2026-03-15
Status: decided (validated against source code)

## Context

OpenClaw has distributed security: exec approvals (shell commands), tool profiles (minimal→full access), prompt injection detection, auth rate limiting, and a security audit CLI. See [[openclaw-security]] for details.

## Decision

**Complement, don't compete.** ClawClip layers user-facing guardrails on top of system-level security. We don't duplicate, replace, or bypass built-in functionality.

## Rationale

- **Built-in is good at system-level concerns** — exec approvals, tool profiles, prompt injection detection are mature and deeply integrated. We can't match that from a plugin.
- **Our value is different** — built-in is a firewall (automated, binary allow/deny, operator-configured). ClawClip is parental controls (human-in-the-loop, nuanced, user-configured).
- **Competing would be a losing strategy** — OpenClaw could break our reimplementation, the community would see us as adversarial, and we'd waste time on solved problems.

## How It Works

ClawClip registers `before_tool_call` at priority 100 (plugin hook layer). Built-in exec approvals and tool profiles run in the tool execution pipeline (after hooks). Both layers contribute independently.

```
            Built-in          ClawClip          Result
Action A:   ALLOW (profile)   ALLOW (policy)    Proceeds
Action B:   ALLOW (profile)   BLOCK (policy)    Blocked by ClawClip
Action C:   ALLOW (profile)   APPROVE?          User prompted
Action D:   BLOCK (profile)   (hook fires but   Blocked by built-in
                               tool never runs)
```

## Messaging

- **Do say:** "ClawClip adds human-in-the-loop approval on top of OpenClaw's built-in security"
- **Don't say:** "ClawClip replaces OpenClaw's security"
- **Analogy:** "Built-in = firewall, ClawClip = parental controls"

## See Also

- [[openclaw-security]] — built-in security components
- [[research/competitors]] — competitive positioning
