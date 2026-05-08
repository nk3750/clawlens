# ClawLens

<!-- TAGLINE — pending Soham draft. One line under the title; voice and positioning are his call. Drops in at commit 3.1. -->

[![CI](https://github.com/nk3750/clawlens/actions/workflows/ci.yml/badge.svg)](https://github.com/nk3750/clawlens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/github/package-json/v/nk3750/clawlens)](package.json)

![ClawLens Dashboard](docs/screenshots/homepage.png)

## What ClawLens does

<!--
WHAT-IT-DOES PROSE — pending Soham draft. Voice, positioning, and the feature
summary go here. The skeleton committed at commit 3 leaves this section as a
placeholder; Soham's prose drops in at commit 3.1. The technical reality the
prose describes (observability + scoring + dashboard + guardrails) is shipped
by the code already in `src/`; this section is positioning, not contract.
-->

## Install

ClawLens is a plugin for [OpenClaw](https://openclaw.ai/). You need a working OpenClaw gateway (`>= 2026.4.0`) already running.

**Recommended:**
```bash
openclaw plugins install openclaw-clawlens
```

OpenClaw checks ClawHub first, falls back to npm. Both resolve to this plugin. The install resolver atomically updates your config (allowlist, denylist, plugin entries, install record) and the gateway daemon restarts itself when it sees the change. No manual edits to `~/.openclaw/openclaw.json` are needed.

Open the dashboard at:

```
http://localhost:18789/plugins/clawlens/
```

Your agents show up the moment they make their first tool call.

### Alternative install methods

<details>
<summary>Install from npm directly</summary>

```bash
openclaw plugins install @nk3750/openclaw-clawlens
```
</details>

<details>
<summary>Install from GitHub (no registry needed)</summary>

```bash
openclaw plugins install clawlens --marketplace nk3750/clawlens
```
</details>

<details>
<summary>Install from source</summary>

```bash
git clone https://github.com/nk3750/clawlens.git
cd clawlens
npm install   # runtime deps only — dist/ and dashboard/dist/ ship pre-built in the repo
openclaw plugins install ./
```

If you intend to modify the source, see [CONTRIBUTING.md](CONTRIBUTING.md) for the rebuild cycle.
</details>

<details>
<summary>Install via the community preview installer</summary>

If you can't or don't want to use `openclaw plugins install`, there is a community-maintained installer at [grepsoham/clawLens-preview](https://github.com/grepsoham/clawLens-preview):

```bash
curl -fsSL https://raw.githubusercontent.com/grepsoham/clawLens-preview/main/install.sh | bash
```

This downloads a release tarball, verifies its checksum, extracts to `~/.clawlens-<version>/`, and edits `~/.openclaw/openclaw.json` directly. It bypasses the OpenClaw plugin install resolver. The installer is maintained as a third-party fork — file install issues at the preview repo, not the main one.
</details>

**LLM risk evaluation** uses your gateway's existing Anthropic credentials by default — no separate API key needed. If your gateway doesn't have Anthropic configured, set `ANTHROPIC_API_KEY` in your environment, or override `risk.llmProvider` in the plugin config.

## Configuration

All settings live under `plugins.entries.clawlens.config` in `~/.openclaw/openclaw.json`. Defaults work out of the box.

| Setting | Default | What it controls |
|---|---|---|
| `auditLogPath` | `~/.openclaw/clawlens/audit.jsonl` | Where the audit log is written |
| `risk.llmEnabled` | `true` | LLM evaluation for ambiguous tool calls |
| `risk.llmEvalThreshold` | `50` | Deterministic score above which the LLM evaluator runs |
| `risk.llmProvider` | auto-detected from OpenClaw | Provider name (`anthropic`, etc.) |
| `alerts.enabled` | `true` | Approval routing for `require_approval` guardrails |
| `alerts.threshold` | `80` | Risk score above which proactive alerts log |
| `retention` | `30d` | Audit log retention |

## What ClawLens does NOT cover (yet)

<!--
LIMITATIONS PROSE — pending Soham draft. Caveats, known gaps, platform support,
partial-coverage disclaimers go here. Soham picks framing and tone. Final
wording is his call. Drops in at commit 3.1.
-->

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). All changes need tests; `npm run check` must pass before merge.

## Reporting issues

- **Bugs:** [open a GitHub issue](https://github.com/nk3750/clawlens/issues/new?template=bug_report.md)
- **Security:** see [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE).
