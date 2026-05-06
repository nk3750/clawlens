# ADR-008: pluginDir Resolution Across Install Methods

> Date: 2026-05-05
> Status: **Open** — short-term fix shipped (`a480311`); long-term approach pending decision
> Severity: P1 — local dev gateway silently serves v1 placeholder HTML instead of the React SPA
> Related: commit `df78356` (the regression), commit `a480311` (the surgical patch)

## Problem

`src/dashboard/routes.ts` resolves the dashboard SPA path as:

```ts
const distDir = deps.pluginDir
  ? path.join(deps.pluginDir, "dashboard", "dist")
  : null;
```

This requires `pluginDir` to be the **package root** so that `<pluginDir>/dashboard/dist/index.html` resolves to the Vite-built SPA. If `pluginDir` is wrong by even one level, the SPA static block at `routes.ts:783-816` is skipped and the request falls through to the legacy v1 placeholder HTML at `routes.ts:821`.

The wiring lives in `index.ts:230`. Three iterations have shipped:

| Commit | `pluginDir` value |
|---|---|
| pre-`96a1755` | `__dirname` (gateway-injected) |
| `96a1755` | `import.meta.dirname` |
| `df78356` | `path.join(import.meta.dirname, "..")` |
| `a480311` (this fix) | `path.basename(here) === "dist" ? path.join(here, "..") : here` |

Each iteration silently broke a different install mode because **`import.meta.dirname` resolves differently depending on whether the file lives in `dist/` or at the package root**, and the OpenClaw loader can be configured to load either.

## Symptom

Local gateway at `http://localhost:18789/plugins/clawlens/` returns the v1 placeholder HTML:

```html
<title>ClawLens Dashboard</title>
<!-- minimal stat tiles: ALLOWED / APPROVED / BLOCKED / TIMED OUT -->
<!-- no /plugins/clawlens/assets/index-*.js reference -->
```

Instead of the SPA `dashboard/dist/index.html`:

```html
<title>ClawLens — Agent Observatory</title>
<script type="module" src="/plugins/clawlens/assets/index-CHcBxX5T.js"></script>
```

API routes (`/api/agents`, `/api/fleet-activity`, `/api/stream`) work fine throughout — only the static SPA serving is broken.

## Root Cause

`~/.openclaw/plugins/installs.json` registers the plugin with:

```json
{
  "pluginId": "clawlens",
  "source": "/Users/REDACTED/code/clawLens/index.ts",
  "rootDir": "/Users/REDACTED/code/clawLens"
}
```

The OpenClaw loader reads `index.ts` directly (via tsx/jiti). At runtime, `import.meta.dirname` is the source repo root (`/Users/REDACTED/code/clawLens`), so `path.join(dirname, "..")` overshoots to `/Users/REDACTED/code/`. `<that>/dashboard/dist/` does not exist; the static handler skips, and the v1 placeholder is served.

Soham's `df78356` fix targeted compiled-from-dist mode (where `import.meta.dirname` is `<root>/dist/` and `..` correctly walks back to `<root>/`). The commit message even acknowledged this:

> Neelabh's older OpenClaw 4.x loader apparently injected a different __dirname semantic at runtime, so his dev clone happened to work by accident.

That premise was incorrect. Neelabh's loader doesn't inject anything — it loads source. The "accident" was that the prior `__dirname` value happened to coincide with the source root because gateway code wraps source-loaded plugins in a CommonJS-like shim where `__dirname` is the source dir. `df78356` swapped the `__dirname` for `import.meta.dirname` (same value in source mode) and added an unconditional `..` walk. That broke source mode while fixing dist mode.

## Install Methods That Must Work

ClawLens is moving toward open-source distribution. The plugin must resolve `pluginDir` correctly under all reasonable install methods:

| # | Method | How OpenClaw loads the plugin | `import.meta.dirname` |
|---|---|---|---|
| 1 | Local dev clone, source-loaded | `installs.json` points at `index.ts`; loader transpiles + executes | `<repo>/` |
| 2 | Local rebuild, compiled mode | `installs.json` points at `dist/index.js` | `<repo>/dist/` |
| 3 | npm tarball install | `npm install clawlens` → loads `node_modules/clawlens/dist/index.js` | `<install>/node_modules/clawlens/dist/` |
| 4 | npm link / pnpm link | Symlink resolves to local repo's `dist/index.js` | Symlink-resolved path under `<dev-clone>/dist/` |
| 5 | Single-file bundle (esbuild / tsup) | Loads bundled JS from arbitrary path | Wherever the bundle lives — could be at root, in `dist/`, or in a custom output dir |
| 6 | Monorepo workspace consumer | pnpm/yarn workspace links the package | Varies |

The **invariant** is the package layout: `<package-root>/dashboard/dist/index.html` is always the SPA entry. So the resolver's job is "find the package root from wherever the entry file happens to live."

## Candidate Resolutions

### A. Basename check (currently shipped — `a480311`)

```ts
const here = import.meta.dirname;
const pluginDir = path.basename(here) === "dist" ? path.join(here, "..") : here;
```

**Pros**
- Minimal — two-line change, no fs ops, no failure modes.
- Solves install methods 1–4 (source, dist, npm tarball, npm link), which cover everything the project ships today.
- Self-explanatory: the rule encodes the actual structural difference between source and compiled modes.

**Cons**
- Hardcodes `"dist"` as the build output dir name. If a future build switches to `tsup`/`esbuild` outputting to `build/` or `out/`, this silently breaks again.
- Doesn't handle bundled installs (#5) where `import.meta.dirname` could be anywhere.
- The check is structural, not goal-driven — it doesn't actually verify that the SPA exists at the chosen path.

### B. Existence probe (goal-driven)

```ts
const here = import.meta.dirname;
const candidates = [here, path.join(here, "..")];
const pluginDir =
  candidates.find((c) => fs.existsSync(path.join(c, "dashboard", "dist", "index.html"))) ??
  here;
```

**Pros**
- Solves install methods 1–4 same as A, **plus** 5 if the bundler keeps the entry file within ≤1 directory of the package root.
- Goal-driven: directly verifies that `dashboard/dist/index.html` exists at the chosen path. If neither candidate has it, the fallback (current dir) lets `routes.ts` gracefully degrade to its v1 placeholder — no surprise crash.
- Doesn't hardcode build dir naming.
- Adds two `existsSync` calls at module load — negligible cost (sub-millisecond) and only runs once.

**Cons**
- Slightly more code than A.
- Still has implicit search depth (`..`); bundlers that nest deeper would need a third candidate.
- Silent fallback on missing SPA could mask packaging bugs in future variants.

### C. Package.json walk-up (idiomatic, fully install-agnostic)

```ts
function findPluginRoot(start: string): string {
  let dir = start;
  while (true) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg.name === "clawlens") return dir;
      } catch {
        // malformed package.json — keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return start; // hit filesystem root, give up
    dir = parent;
  }
}

const pluginDir = findPluginRoot(import.meta.dirname);
```

**Pros**
- Fully install-mode-agnostic. Works for #1–#6 and any future install variant.
- Mirrors the standard Node.js convention used by `find-up`, `pkg-up`, and most monorepo tooling — readers will recognize the pattern.
- Anchored to a stable, semantic marker (the package's own `package.json` with the right `name`), not a structural assumption about directory naming.
- Defensive: if the marker can't be found (e.g., bundler strips `package.json`), falls back to `start` so the gateway doesn't crash.

**Cons**
- ~15 lines vs A's 1 line. Adds complexity that is overkill for the install methods we ship today.
- Depends on the package's `name` field staying `"clawlens"`. If it ever changes (rebrand, scoped package like `@openclaw/clawlens`), this needs updating — though that change would be visible in `package.json` itself, so the coupling is at least co-located.
- Filesystem walk runs once at startup — still cheap, but more than B.

## Recommendation

**Move to C (package.json walk-up).**

The argument for going beyond A or B is that ClawLens is going open-source. Once it's listed in a registry or shipped as a tarball, install methods 3–6 become real, and we won't be able to predict which one a given operator will use. Option C is the only one of the three that resolves correctly **without** us having to think about install layout.

The cost is small (~15 lines, one fs walk at startup) and the payoff is "set it and forget it" — the resolver works regardless of how the package is consumed, including future install methods we haven't yet enumerated.

A is sufficient as a stopgap; it's already shipped on `main` (`a480311`) and unblocks current dev work. B is a reasonable middle ground if Option C feels too defensive. But for the open-source release, C is the cleanest answer.

## Open question

- Should the resolver also pin to `OpenClawPluginDefinition.id === "clawlens"` from `openclaw.plugin.json` instead of `package.json#name`? That manifest is the OpenClaw-canonical source of truth for plugin identity. Tradeoff: an extra file read, but decouples from npm's `package.json` semantics if the package is ever renamed for npm distribution while keeping the OpenClaw plugin id stable.

## Test plan (whichever option lands)

1. Source-loaded mode (current dev clone): gateway serves SPA `<title>ClawLens — Agent Observatory</title>` and references `/plugins/clawlens/assets/index-*.js`.
2. Compiled-from-dist mode: temporarily flip `installs.json` source to `.../dist/index.js`, restart, expect same SPA served.
3. npm tarball mode: `npm pack`, install the resulting tgz into a scratch dir, point OpenClaw at it, expect same SPA served.
4. Negative: temporarily rename `dashboard/dist/index.html`, expect graceful fall-through to v1 placeholder (no crash).

## Implementation order if C is chosen

1. Add `findPluginRoot()` helper to `index.ts` (or extract to `src/util/find-package-root.ts` if it gets reused).
2. Replace `pluginDir` line at `index.ts:230` with `findPluginRoot(import.meta.dirname)`.
3. Add a unit test under `tests/` that mocks `fs.existsSync`/`readFileSync` and exercises:
   - source-loaded layout
   - compiled-from-dist layout
   - tarball-under-node_modules layout
   - missing `package.json` fallback
   - wrong-`name` `package.json` keeps walking
4. Rebuild backend dist; commit the rebuilt dist alongside the source change (per project convention).
