<h1 align="center">
  <img src="https://raw.githubusercontent.com/nk3750/clawlens/main/docs/assets/clawlens-logo.jpeg" alt="ClawLens" width="120"><br>
  ClawLens
</h1>

<p align="center">
  <strong>Agent observability and guardrails for <a href="https://openclaw.ai/">OpenClaw</a>.</strong><br>
  See every tool call, understand the risk, and add guardrails from the same dashboard.
</p>

<p align="center">
  <a href="https://github.com/nk3750/clawlens/actions/workflows/ci.yml"><img src="https://github.com/nk3750/clawlens/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="package.json"><img src="https://img.shields.io/github/package-json/v/nk3750/clawlens" alt="Version"></a>
  <img src="https://img.shields.io/badge/openclaw-plugin-orange" alt="OpenClaw Plugin">
</p>

ClawLens is a local OpenClaw plugin for monitoring agent activity. It records tool calls, scores risky behavior, shows live sessions in a dashboard, and lets you create `block`, `require_approval`, or `allow_notify` guardrails from real agent actions.

Use it when your agents can run shell commands, edit files, call external APIs, or operate across multiple sessions and you want an audit trail plus operator-controlled guardrails.

<p align="center">
  <a href="https://youtu.be/AKzhw5GWw5I">
    <img src="https://raw.githubusercontent.com/nk3750/clawlens/main/docs/assets/clawlens-thumbnail.png" alt="Watch the ClawLens product demo" width="900">
  </a><br>
  <sub><a href="https://youtu.be/AKzhw5GWw5I">Watch the 2-minute product demo</a></sub>
</p>

---

## Quickstart

ClawLens requires a running OpenClaw gateway (`>= 2026.4.0`).

```bash
openclaw plugins install @nk3750/openclaw-clawlens
```

Open the dashboard:

```text
http://localhost:18789/plugins/clawlens/
```

Your agents appear after their first tool call. The standard npm install path updates OpenClaw's plugin config automatically; you do not need to edit `~/.openclaw/openclaw.json` by hand.

<details>
<summary>Other install paths</summary>

Install from the public GitHub mirror:

```bash
openclaw plugins install clawlens --marketplace nk3750/clawlens
```

Install from source:

```bash
git clone https://github.com/nk3750/clawlens.git
cd clawlens
npm install
openclaw plugins install ./
```

If you plan to modify the source, see [CONTRIBUTING.md](CONTRIBUTING.md).

</details>

---

## Why ClawLens

Agents often take many small actions before the one that matters. ClawLens gives you the activity stream, risk context, and guardrail controls in one place.

| Need | ClawLens gives you |
|---|---|
| Know what happened | A local JSONL audit log plus live dashboard views for agents, sessions, and individual tool calls. |
| Spot risky behavior | Deterministic risk scores and tags for destructive commands, external network access, remote operations, sensitive system paths, credential access, and persistence. |
| Respond quickly | Guardrails created from observed actions, scoped to one agent or the whole fleet. |
| Review later | Hash-chained audit entries that make later edits, deletes, or reordering detectable. |
| Add LLM context | Optional LLM risk evaluation and session summaries when `risk.llmEnabled=true`, using redacted tool-call metadata. |

<p align="center">
  <a href="https://raw.githubusercontent.com/nk3750/clawlens/main/docs/assets/clawlens-homepage.png" target="_self">
    <img src="https://raw.githubusercontent.com/nk3750/clawlens/main/docs/assets/clawlens-homepage.png" alt="ClawLens dashboard" width="900">
  </a>
</p>

---

## How It Works

1. OpenClaw runs your agents and tool calls as usual.
2. ClawLens observes each tool call, computes a deterministic local risk score, redacts common credential patterns, and writes an audit entry.
3. The local dashboard updates with agents, sessions, risk mix, recent actions, and Attention Inbox items.
4. When you create a guardrail, matching future tool calls can be blocked, paused for approval, or allowed with a local notification record.

No SDK, proxy, database, or separate service stack is required.

---

## Guardrails

Guardrails are rules you create from real activity.

| Action | Behavior |
|---|---|
| `block` | Rejects matching tool calls before they run. |
| `require_approval` | Pauses matching calls and uses OpenClaw's configured approval flow. |
| `allow_notify` | Allows the call while creating local audit and Attention Inbox signals. |

Rules can match specific commands, paths, URLs, tools, agents, or broader patterns. They can apply to one agent or the whole fleet.

<p align="center">
  <a href="https://raw.githubusercontent.com/nk3750/clawlens/main/docs/assets/clawlens-guardrail-add.png" target="_self">
    <img src="https://raw.githubusercontent.com/nk3750/clawlens/main/docs/assets/clawlens-guardrail-add.png" alt="Create a ClawLens guardrail" width="900">
  </a>
</p>

---

## Data Handling

ClawLens is designed for local operation by default. It is still an observability plugin, so it sees tool names and tool parameters; treat its audit log like other sensitive development logs.

| Flow | Default | Leaves your machine? | Notes |
|---|---:|---:|---|
| Dashboard | On | No | Served by the local OpenClaw gateway. |
| Audit log | On | No | Written to `~/.openclaw/clawlens/audit.jsonl`; hash-chained, not encrypted. |
| Deterministic scoring | On | No | Runs locally on tool names and params. |
| Credential redaction | On | No | Best-effort redaction before audit persistence, summaries, alerts, approval text, and opt-in LLM evaluation. |
| LLM evaluation | Off | Yes, if enabled | Sends redacted tool-call metadata to your configured OpenClaw LLM provider when `risk.llmEnabled=true`. |
| Generic high-risk alerts | Off | Depends on OpenClaw routing | Alert text is redacted by default. |
| `require_approval` guardrails | User-created only | Depends on OpenClaw approval channel | External approval channels may receive prompt text. |
| `allow_notify` guardrails | User-created only | No by default | Creates local audit rows and local Attention Inbox items. |

On POSIX systems, ClawLens creates the audit directory/file with owner-only permissions where supported. On Windows, audit-log access follows the parent directory's ACLs.

To remove local audit history:

```bash
rm -f ~/.openclaw/clawlens/audit.jsonl
```

### Optional LLM Evaluation

LLM evaluation is disabled unless you set `risk.llmEnabled=true`. When enabled, ClawLens can use your configured OpenClaw LLM provider to add context to eligible risk evaluations and generate session summaries.

When enabled, ClawLens sends a redacted JSON payload containing:

- current tool name
- redacted current tool parameters
- up to 5 recent actions with tool name, redacted parameters, and risk score
- preliminary deterministic risk score, tier, and tags

ClawLens does not read LLM API keys from environment variables and does not send LLM API keys in prompts. Provider credentials are handled by OpenClaw's model/auth runtime.

Redaction is best-effort. ClawLens removes common credential patterns before LLM evaluation, but you should still avoid placing secrets in tool parameters.

---

## Configuration

Most users do not need custom configuration. Common settings live under `plugins.entries.clawlens.config` in `~/.openclaw/openclaw.json`.

| Setting | Default | What it controls |
|---|---|---|
| `auditLogPath` | `~/.openclaw/clawlens/audit.jsonl` | Where ClawLens writes the JSONL audit log. |
| `risk.llmEnabled` | `false` | Enables opt-in LLM risk evaluation and LLM-generated summaries. |
| `risk.llmEvalThreshold` | `50` | Score above which opt-in LLM evaluation can run when enabled. |
| `alerts.enabled` | `false` | Enables generic high-risk alerts. If routed externally by OpenClaw, alert text may leave your machine. |
| `alerts.threshold` | `80` | Score above which generic high-risk alerts fire when alerts are enabled. |
| `alerts.includeParamValues` | `false` | Includes sanitized command/path/URL details in alert messages. Credential patterns are still redacted. |

`risk.llmEvalThreshold` only controls opt-in LLM evaluation. It does not control guardrail matching or Attention Inbox freshness. Guardrails fire when a user-created rule matches. `alerts.threshold` only controls generic high-risk alerts when `alerts.enabled=true`.

<details>
<summary>Advanced settings and v1.0.1 migration notes</summary>

The plugin manifest also supports storage-path overrides for guardrails, attention state, saved searches, digest settings, and dashboard alert links. See [openclaw.plugin.json](openclaw.plugin.json) for the full schema.

`risk.llmProvider`, `risk.llmModel`, and `risk.llmApiKeyEnv` are deprecated no-ops in v1.0.1. They are accepted temporarily so existing configs continue to load, but ClawLens ignores them. Remove them from your config before v1.1.0.

</details>

---

## Scope And Limits

ClawLens complements OpenClaw's built-in security. It does not replace tool profiles, exec approvals, prompt-injection detection, OS permissions, or secret scanning.

- Guardrails enforce on OpenClaw tool calls. They do not inspect every byte inside arbitrary payloads.
- Pattern matching catches obvious risky shapes, but ClawLens is not a full shell interpreter.
- LLM evaluation can add context when explicitly enabled; deterministic local scoring remains the default.
- The audit log is tamper-evident, not encrypted or hidden from your OS user, backups, or administrators.
- Sub-agents are observed and scored, but guardrails set for a parent agent do not automatically apply to spawned children.

---

## FAQ

<details>
<summary><strong>Does ClawLens collect telemetry?</strong></summary>

ClawLens does not operate a cloud service, analytics pipeline, telemetry endpoint, install-ping system, or machine-ID system. Installing through npm, GitHub, or ClawHub may still create ordinary registry or download metadata outside ClawLens.

</details>

<details>
<summary><strong>Does it block tool calls by default?</strong></summary>

No. By default, ClawLens observes and scores. Blocking only happens after you create a `block` or `require_approval` guardrail.

</details>

<details>
<summary><strong>Can I run it without any external data flow?</strong></summary>

Yes. Keep `risk.llmEnabled=false`, leave `alerts.enabled=false`, and avoid external OpenClaw approval channels for ClawLens guardrails. The default dashboard, audit log, deterministic scoring, and local guardrail records run locally.

</details>

<details>
<summary><strong>What does LLM evaluation cost?</strong></summary>

Nothing by default because LLM evaluation is off. When enabled, ClawLens uses your configured OpenClaw model/auth runtime, so usage is billed according to your existing provider setup.

</details>

<details>
<summary><strong>Can I export the audit log?</strong></summary>

Yes. Use the dashboard export action, run `openclaw clawlens audit export --format json --since 7d` (or `csv`), or read the hash-chained JSONL at `~/.openclaw/clawlens/audit.jsonl`.

</details>

<details>
<summary><strong>What if OpenClaw blocks installation?</strong></summary>

The standard v1.0.1 install should not require `--dangerously-force-unsafe-install`. If OpenClaw blocks installation, do not force it; open an issue with the full installer warning.

</details>

---

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). All changes need tests, and `npm run check` must pass before merge.

## Reporting Issues

- **Bugs:** [open a GitHub issue](https://github.com/nk3750/clawlens/issues/new?template=bug_report.md)
- **Security:** see [SECURITY.md](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).
