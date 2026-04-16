# Changelog

> **Status:** Initial draft -- under review

## 0.2.0 -- 2026-04-18

Initial public release.

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
- Real-time Telegram notifications for high-risk actions with configurable threshold and quiet hours

**Quality**
- 700+ tests, TypeScript strict mode, 3 production dependencies
