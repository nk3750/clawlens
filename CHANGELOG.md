# Changelog

## 1.0.0 -- 2026-05-08

First public OSS release.

### Changed

- **Manifest** (`openclaw.plugin.json`): rewrite `configSchema` with `additionalProperties: false` at every stable nested object (top, `risk`, `alerts`); document the four config fields the runtime reads (`guardrailsPath`, `attentionStatePath`, `savedSearchesPath`, `dashboardUrl`); drop the dead-metadata fields `activation.onStartup` and `enabledByDefault: true` (verified no-op for external plugins against openclaw v2026.5.7); fix description; bump version to 1.0.0.
- **Package metadata** (`package.json`): add `license` (MIT), `repository`, `bugs`, `homepage`, `keywords`, `engines`, `author`. Bump version to 1.0.0.
- **CLI** (`clawlens init`): the printed config snippet now uses the actual install path instead of a hardcoded `~/code/clawLens`. Source-clone install (Channel 4) prints the correct value for the user's machine.

### Added

- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
- `SECURITY.md` with vulnerability reporting via GitHub Security Advisories.
- `CONTRIBUTING.md` "Distribution policy (public mirror)" section documenting the rewrite-on-release model so outside contributors know to reference work by tag, not commit SHA.

### Notes

- ClawLens runs locally; no telemetry collection from the plugin itself. ClawHub (the registry users install from) reports anonymous install counts on its package page; opt out with `CLAWHUB_DISABLE_TELEMETRY=1`.
- This is the first public release. The plugin previously circulated as a preview tarball via `grepsoham/clawLens-preview`, which remains a third-party convenience installer alongside the canonical `openclaw plugins install openclaw-clawlens` path.

## 0.2.0 -- 2026-04-18

Preview-era release (not on a public registry; circulated via the `clawLens-preview` installer fork).

### Added

**Core Engine**
- Two-tier risk scoring -- deterministic scoring (<5ms) on every tool call, async LLM evaluation for high-risk calls with 3-path fallback and caching
- 14-category exec command classifier (read-only, search, git-read, git-write, network, destructive, persistence, etc.)
- Hash-chained JSONL audit log with SHA-256 tamper evidence and CLI export
- User-driven guardrails -- exact-match block/require-approval rules, created from observed behavior

**Dashboard**
- React SPA with 5 pages: Agents overview, Agent Detail, Session Detail, Activity feed, Guardrails
- Real-time activity feed via SSE -- new tool calls appear as they happen, no refresh needed
- 3-tier attention system -- pending approvals (pulsing countdown), blocked/timed-out actions, high-risk unguarded calls
- Session timeline with action-count-proportional segments, active session pulse, and blocked session markers
- Category breakdown bars on agent cards with icons, labels, and proportional display

**Alerts**
- Telegram approval routing for `require_approval` guardrails. Proactive risk-score push alerts log to the gateway only — they require an upstream OpenClaw `notify` primitive (tracked at [#27](https://github.com/nk3750/clawlens/issues/27)).

**Quality**
- 700+ tests, TypeScript strict mode, 3 production dependencies
