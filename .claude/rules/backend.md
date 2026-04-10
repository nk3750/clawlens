---
paths:
  - "src/**"
  - "index.ts"
---

# Backend Rules

## TypeScript
- **`strict: true`** in `tsconfig.json` — do not weaken
- **No `any`** — use `unknown` and narrow. Only exception: `src/types.ts` for OpenClaw SDK signatures, marked with `biome-ignore`
- **No `@ts-ignore` or `@ts-expect-error`** — fix the type error instead
- **Use `type` imports** for type-only imports: `import type { Foo } from "./bar"`
- **No dead code** — no commented-out blocks, no unused imports, no TODO without context

## OpenClaw Plugin SDK
- ClawLens is an **external plugin**. Never import from OpenClaw internals — only use types in `src/types.ts`
- `runtime.agent.runEmbeddedPiAgent()` is the primary LLM mechanism (not subagent)
- `runtime.modelAuth.resolveApiKeyForProvider()` takes `{ provider, cfg }` object, NOT a bare string
- `runtime.subagent` is NOT available in plugin hooks — it is request-scoped
- `register()` is called multiple times with different `api` objects — hooks registered per unique api via WeakSet
- See `docs/OPERATIONS.md` for full SDK reference

## Hook Pipeline
- `before_tool_call` handler is **async** — LLM evals are awaited (blocking for score >= 50)
- Guardrail check runs first, before risk scoring (when implemented)
- Audit log writes are async fire-and-forget in `after_tool_call`
- **< 50ms overhead** for auto-allowed actions

## Security
- Hash chain integrity on audit log — never skip or fake hashes
- No secrets in code — API keys from environment variables
- Sanitize params in audit log entries (no credential leakage)
- Path traversal protection on dashboard static file serving

## Dependencies
- **Justify any new package** — we have 3 production deps, keep it minimal
- Dashboard has its own `package.json` — don't mix backend and frontend deps
