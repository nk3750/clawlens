# OpenClaw first, abstract later

Date: 2026-03-15
Status: decided

## Context

ClawClip's guardrails concept (policy enforcement, approval flows, audit trails) could apply to any agent platform — LangChain, CrewAI, Claude tool_use, etc. We had to decide: build a generic framework now, or go deep on OpenClaw first?

## Decision

**Build for OpenClaw first. Extract a generic framework later, after we have 2-3 platform implementations to inform the abstraction.**

## Rationale

### Premature abstraction is worse than no abstraction

Every agent platform has different hook models, tool call shapes, and lifecycle concepts. OpenClaw has `before_tool_call` with `{toolName, params}` returning `{block, blockReason}`. Other platforms will have completely different primitives. Abstracting from one example produces a leaky abstraction that fits nothing well.

### Deep integration is our competitive advantage

Being OpenClaw-native (plugin with `before_tool_call` at priority 100, gateway methods for approval, in-process execution) is what differentiates us from Guardrails AI and LangSmith. Going generic dilutes the wedge.

### Traction first, generality second

We need users, feedback on policy UX, real-world approval flow testing. None of that requires platform-agnosticism.

### "Build it twice" produces better abstractions

When we add platform #2, we'll see exactly what's shared (policy engine, YAML format, audit log) vs. platform-specific (hook registration, blocking API, approval delivery). The seams will be obvious from experience, not speculation.

## Implementation

- Build ClawClip as an OpenClaw plugin with no abstraction layers
- Keep code naturally clean — policy engine separate from hook handlers, audit logger separate from approval flow (good design, not premature abstraction)
- The YAML policy format is naturally portable — tool matching, rate limits, approval rules don't reference OpenClaw internals
- When demand appears for platform #2, build an adapter and extract the common layer
- That common layer becomes the generic framework

## Sequence

1. Ship ClawClip for OpenClaw, get users
2. When a second platform shows demand, build an adapter
3. Extract common layer after 2-3 concrete implementations (rule of three)
4. Common layer becomes the platform-agnostic framework

## See Also

- [[decisions/001-target-openclaw-first]] — original platform targeting decision
- [[decisions/003-complement-not-replace]] — positioning within OpenClaw ecosystem
