# Use YAML for policies instead of JSON5

Date: 2026-03-15
Status: decided

## Context

OpenClaw uses **JSON5** for its configuration (`~/.openclaw/openclaw.json`). This is confirmed from the source code — the config is loaded as JSON5, and all 20+ modular config type files in `src/config/` define JSON-compatible structures.

ClawClip needs a format for user-defined policy files. Options considered:

1. **JSON5** — match OpenClaw's convention
2. **YAML** — widely used for config/policy files
3. **TOML** — growing in popularity
4. **Custom DSL** — maximum expressiveness

## Decision

Use **YAML** for ClawClip policy files. This is a **conscious divergence** from OpenClaw's JSON5 convention.

## Rationale

### Why YAML over JSON5

- **Comments are natural** — YAML's `#` comments are universally understood. JSON5 supports comments but they feel bolted-on.
- **More readable for non-technical users** — no braces, no quotes on keys, indentation-based structure matches how people think about nested rules.
- **Policy/config standard** — Kubernetes, GitHub Actions, Docker Compose, Ansible all use YAML for policies. Users expect it.
- **Multiline strings** — policy `reason` fields benefit from YAML's multiline string support.
- **Ecosystem** — excellent parsers in every language (js-yaml, PyYAML). Schema validation via JSON Schema works with both.

### Why not match OpenClaw's JSON5

- ClawClip policies are **user-facing** — they need to be as readable as possible.
- OpenClaw's JSON5 is **developer/operator-facing** config — different audience. The config defines gateway ports, auth modes, plugin entries, TLS settings — technical details that developers are comfortable with in JSON5.
- ClawClip policies are **rule lists with match conditions** — YAML's list syntax and indentation are more natural for this structure than JSON5's arrays and braces.
- Users won't be editing both files in the same session — context-switching cost is low.
- OpenClaw's own plugin config (in `openclaw.plugin.json`) uses JSON for manifests, but plugin-specific user config is whatever the plugin chooses. We choose YAML for policies.
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

Users who configure both OpenClaw (`~/.openclaw/openclaw.json`, JSON5) and ClawClip policies (YAML) may notice the format difference. This is a minor UX friction we accept in exchange for a better policy authoring experience.

## Example

```yaml
# ClawClip policy — easy to read and write
rules:
  - name: "Approve external emails"
    match:
      tool: "message"     # OpenClaw tool name (confirmed from tool-catalog.ts)
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
        tool: "message",
        parameters: { to: "!*@mycompany.com" }
      },
      action: "approval_required",
      reason: "External email — please confirm recipient"
    }
  ]
}
```
