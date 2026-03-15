# Target OpenClaw as first platform

Date: 2026-03-15
Status: decided

## Context

Could build framework-agnostic guardrails (LangChain, OpenAI SDK, etc.) or target a specific platform first.

## Decision

Build for OpenClaw first, then generalize.

## Rationale

- OpenClaw users have high rogue-agent risk (file access, browser control, messaging, 50+ integrations)
- Large non-technical user base — they can't build their own guardrails
- Active community (Discord, ClawHub) = built-in distribution
- ClawHub plugin marketplace for frictionless distribution
- "Rogue agent" horror stories are visible and shareable — organic marketing

## Tradeoff

Smaller initial TAM than framework-agnostic, but sharper wedge and faster path to real users. Generalize after proving value here.
