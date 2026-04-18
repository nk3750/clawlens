---
name: Bug report
about: Something is broken, wrong, or unexpected
title: "bug: "
labels: bug
---

## Summary

<!-- One line. What's broken? -->

## Observed behavior

<!-- What actually happens. Include concrete values, error text, or screenshots. -->

## Expected behavior

<!-- What should happen instead. -->

## Reproduction

<!-- Minimal steps. If it only repros from the live system, list the agent / session / tool call. -->

1.
2.
3.

## Evidence

<!-- All that apply. Link or paste. -->

- **Audit log** (`~/.openclaw/clawlens/audit.jsonl`): toolCallId(s) + timestamp window
- **Gateway log** (`~/.openclaw/logs/gateway.log`): last 20 lines around the event
- **Dashboard**: `http://localhost:18789/plugins/clawlens/session/<sessionKey>?highlightToolCallId=<id>`
- **Screenshot** (UI bugs only)

## Severity

<!-- Pick one. -->

- [ ] **p0** — data loss, security issue, or gateway crash
- [ ] **p1** — user-blocking: a core flow is unusable
- [ ] **p2** — degraded: wrong label, cosmetic, edge case

## Suspected root cause

<!-- Only fill in if you've actually looked. "Unknown" is an acceptable answer. -->

## Environment

- ClawLens version: <!-- from package.json -->
- Commit: <!-- `git rev-parse HEAD` -->
- OpenClaw gateway version: <!-- if known -->
