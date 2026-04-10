---
paths:
  - "tests/**"
---

# Testing Rules

## Requirements
- **Every change — small or large — MUST include tests. No exceptions.** This plugin must be production-grade.
- If you change a line of code, add or update tests covering both positive (happy path) and negative (error, edge case, fallback) scenarios.
- This includes bug fixes, refactors, new features, registration logic, type changes — everything.
- **Never break existing tests** — run `npm test` after every change.

## Framework
- **Vitest** — tests live in `tests/` directory
- Run all: `npm test`
- Run specific: `npx vitest run tests/llm-evaluator.test.ts`
- Run with filter: `npx vitest run -t "pattern name"`

## Patterns
- Use the `entry()` helper for building test data (see `tests/dashboard-v2-api.test.ts`)
- Mock time with `vi.useFakeTimers()` / `vi.setSystemTime()` for timestamp-dependent tests
- Use `vi.fn()` for mocks, `vi.mock()` for module mocking
- Clean up env vars in `finally` blocks (see `tests/llm-evaluator.test.ts` for pattern)
- Use `vi.mocked()` for type-safe access to mocked functions

## Verification
- Run `npm run check` (tests + lint) as final verification before committing
- All tests must pass — 0 failures
- Biome lint must pass — 0 errors

## Existing Test Files
| File | Covers |
|------|--------|
| `llm-evaluator.test.ts` | Eval cascade, all 4 paths, parsing, providers |
| `before-tool-call.test.ts` | Hook handler async behavior, eval await, cache, modes |
| `index-registration.test.ts` | Duplicate registration guard, WeakSet tracking |
| `dashboard-v2-api.test.ts` | Agent detail, range filtering, risk trend, sessions |
| `exec-parser.test.ts` | Command parsing, categories, risk flags |
| `risk-scorer.test.ts` | Score computation, modifiers, tier thresholds |
| `policy-engine.test.ts` | Rule matching, evaluation, defaults |
| `audit-logger.test.ts` | JSONL writing, hash chain, reading |
| `session-summary.test.ts` | LLM summary generation, caching |
