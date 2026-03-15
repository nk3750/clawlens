# Include a lightweight dashboard in v0.1

Date: 2026-03-15
Status: decided

## Context

ClawClip logs every tool call decision to JSONL. Non-technical users (our target) won't read log files. We need the guardrails to be visible. Also, as co-founders, we need something demo-able.

## Decision

**Ship a minimal dashboard in v0.1**, served directly from the plugin via `api.registerHttpRoute()` on the OpenClaw gateway. No separate frontend project.

## What's In (v0.1)

The dashboard answers: **"What is my agent doing and what did ClawClip do about it?"**

- Recent tool calls — what the agent did, what ClawClip decided (allow/block/approved)
- Active policies — what rules are loaded
- Pending approvals — anything waiting for user response
- Basic stats — X allowed, Y blocked, Z approved today

## What's Out (v0.2+)

- Agent conversation history (OpenClaw's domain)
- Model usage / cost tracking (different product)
- Channel management (OpenClaw's domain)
- Team / multi-user views (enterprise feature)

## Rationale

### Why include in v0.1

- **Non-technical users won't read JSONL** — a page showing decisions is table stakes
- **Demo-able** — "look at the terminal" doesn't land; a dashboard does
- **Free infrastructure** — `api.registerHttpRoute()` means we serve HTML from the plugin on the existing gateway, zero deployment overhead
- **Keeps scope tight** — one or two pages, not a full app

### Why not a full dashboard

The dashboard should make guardrails visible, not become a general agent management platform. That's scope creep into a different product. If there's demand for broader observability, that's a separate decision.

## Implementation

- Register HTTP routes via the plugin API: `api.registerHttpRoute()`
- Serve on the existing gateway (port 18789) under `/clawclip/` path prefix
- Plain HTML + minimal JS — no React, no build pipeline
- Read from the same JSONL audit log and in-memory policy state
- Static assets bundled with the plugin

## See Also

- [[product/mvp-scope]] — dashboard in v0.1 feature list
- [[architecture/system-overview]] — ClawClip component architecture
