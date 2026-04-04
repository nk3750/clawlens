# Use YAML for policies instead of JSON5

Date: 2026-03-15
Status: decided

## Context

OpenClaw uses **JSON5** for configuration (`~/.openclaw/openclaw.json`). ClawLens needs a format for user-defined policy files.

## Decision

Use **YAML** for ClawLens policy files — a conscious divergence from OpenClaw's JSON5.

## Rationale

- **Readability for non-technical users** — no braces, no quotes on keys, indentation-based
- **Comments** — YAML `#` comments are universally understood
- **Policy standard** — Kubernetes, GitHub Actions, Docker Compose all use YAML for policies
- **Multiline strings** — policy `reason` fields benefit from this
- **Different audience** — OpenClaw's JSON5 is operator-facing config (ports, auth, TLS). Our YAML is user-facing policy rules. Users won't edit both in the same session.

## Example

```yaml
# ClawLens policy — readable, commentable
rules:
  - name: "Approve external emails"
    match:
      tool: "message"
      parameters:
        to: "!*@mycompany.com"
    action: approval_required
    reason: "External email — please confirm recipient"
```

vs. JSON5:
```json5
{
  rules: [{
    name: "Approve external emails",
    match: { tool: "message", parameters: { to: "!*@mycompany.com" } },
    action: "approval_required",
    reason: "External email — please confirm recipient"
  }]
}
```
