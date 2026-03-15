# Use YAML for policies instead of JSON5

Date: 2026-03-15
Status: decided

## Context

OpenClaw uses JSON5 for its own configuration files (`config.json5`). ClawClip needs a format for user-defined policy files. Options considered:

1. **JSON5** — match OpenClaw's convention
2. **YAML** — widely used for config/policy files
3. **TOML** — growing in popularity
4. **Custom DSL** — maximum expressiveness

## Decision

Use **YAML** for ClawClip policy files.

## Rationale

### Why YAML over JSON5

- **Comments are natural** — YAML's `#` comments are universally understood. JSON5 supports comments but they feel bolted-on.
- **More readable for non-technical users** — no braces, no quotes on keys, indentation-based structure matches how people think about nested rules.
- **Policy/config standard** — Kubernetes, GitHub Actions, Docker Compose, Ansible all use YAML for policies. Users expect it.
- **Multiline strings** — policy `reason` fields benefit from YAML's multiline string support.
- **Ecosystem** — excellent parsers in every language (js-yaml, PyYAML). Schema validation via JSON Schema works with both.

### Why not match OpenClaw's JSON5

- ClawClip policies are **user-facing** — they need to be as readable as possible.
- OpenClaw's JSON5 is **developer-facing** config — different audience.
- Users won't be editing both files in the same session — context-switching cost is low.
- We can always add JSON5 support later if users request it.

### Why not TOML

- Less expressive for nested structures (policy rules with match conditions)
- Less widely known among non-technical users
- YAML's list syntax is more natural for ordered rule lists

### Why not a custom DSL

- Over-engineering for v0.1
- Every custom DSL needs its own docs, error messages, and editor support
- YAML gets us 90% of the expressiveness with zero learning curve

## Tradeoff

Users who configure both OpenClaw (JSON5) and ClawClip (YAML) in the same session may notice the format difference. This is a minor UX friction we accept in exchange for a better policy authoring experience.

## Example

```yaml
# ClawClip policy — easy to read and write
rules:
  - name: "Approve external emails"
    match:
      skill: "email-send"
      parameters:
        to: "!*@mycompany.com"  # NOT internal
    action: approval_required
    reason: "External email — please confirm recipient"
```

vs. JSON5 equivalent:

```json5
// Less readable for the same content
{
  rules: [
    {
      name: "Approve external emails",
      match: {
        skill: "email-send",
        parameters: { to: "!*@mycompany.com" }
      },
      action: "approval_required",
      reason: "External email — please confirm recipient"
    }
  ]
}
```
