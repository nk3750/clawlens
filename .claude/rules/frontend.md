---
paths:
  - "dashboard/**"
---

# Frontend Rules (Dashboard)

React SPA at `dashboard/` — Vite + React 18 + Tailwind CSS 3. Not Next.js — no SSR, no "use client".

## Data Fetching
- `useApi<T>(path)` for REST API calls
- `useSSE<T>(path, callback)` for live streaming
- `useSessionSummary(sessionKey)` for on-demand LLM summaries

## Styling
- **CSS custom properties** (`--cl-*` tokens in `dashboard/src/index.css`) for ALL colors
- **Never hardcode hex values** in components — use `riskColor(tier)` / `riskColorRaw(tier)` from `utils.ts`
- **Tailwind + CSS vars** — use Tailwind utilities with CSS variable values
- **Spring easing** for animations: `var(--cl-spring)` timing function, `var(--cl-spring-duration)`

## Charts & Icons
- **Inline SVG** for ALL charts, sparklines, and icons — no chart libraries (no D3, no Recharts)
- Sparkline: interactive with hit areas, hover tooltips, tier-colored segments
- Risk bars: tier-colored fill with marker dot

## Types & Logic
- **Types in `dashboard/src/lib/types.ts`** must match backend response types in `src/dashboard/api.ts`
- Frontend `tsconfig.json` has `noUnusedLocals` and `noUnusedParameters` — respect them
- Shared logic goes in `dashboard/src/lib/` (e.g., `groupEntries.ts`, `utils.ts`)

## Entry Display (Centralized — never duplicate)
- `deriveTags()` — tag derivation from entry data
- `entryIcon()` — icon selection by tool/category
- `describeEntry()` — human-readable entry description
- `riskLeftBorder()` — tier-colored left border for risk rows
- All in `dashboard/src/lib/utils.ts` — covers ALL ExecCategory values and tool names

## Build
- Run `cd dashboard && npm run build` after changes to verify build succeeds
- Dashboard is served from `dashboard/dist/` by the gateway — gateway restart required after rebuild
