# Contributing to ClawLens

Thanks for your interest in contributing to ClawLens. This guide covers everything you need to get started.

## Getting Started

```bash
git clone https://github.com/nk3750/clawlens.git
cd clawlens
npm install
cd dashboard && npm install && cd ..
npm run check   # runs tests + lint — if this passes, you're set up
```

## Development

**Backend** (plugin core, risk scoring, audit, hooks):
```bash
npm test              # run all backend tests (Vitest)
npm run lint:fix      # auto-fix formatting (Biome)
```

**Frontend** (React dashboard):
```bash
cd dashboard
npm run dev           # start Vite dev server
npm run build         # production build
```

**Full verification:**
```bash
npm run check         # tests + lint in one command — run this before every PR
```

## Submitting Changes

1. Fork the repo and create a branch from `main`.
2. Make your changes.
3. Add or update tests for anything you changed.
4. Run `npm run check` and confirm it passes.
5. If you changed the dashboard, also run `cd dashboard && npm run build` to verify the production build.
6. Open a pull request. Keep PRs focused on a single change.

## Code Style

Biome handles all formatting and linting. No manual formatting needed.

- TypeScript strict mode everywhere
- Run `npm run lint:fix` to auto-format
- Config is in `biome.json`

## Tests

Every change needs tests. Backend tests use Vitest and live in `tests/`. Run `npm run check` as final verification before submitting.

## CI

Every PR runs three jobs via [GitHub Actions](.github/workflows/ci.yml): backend (Vitest tests + Biome lint), dashboard (build with bundled typecheck), and a typecheck + dist-freshness gate. The PR cannot merge until all three are green.

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

<details>
<summary><strong>Distribution policy (public mirror, advanced reading)</strong></summary>

The public `nk3750/clawlens` repository is a deterministic projection of a separate private development repository, rebuilt and force-pushed on every release via `git filter-repo`. Practical implications for outside contributors:

- **History on `main` is rewritten on every release.** If you fork or branch off the public repo, expect to rebase or re-fork after each release. Repository content is consistent within a release cycle.
- **Reference work by tag, not commit SHA.** Tagged releases (`v1.x.y`) and their associated GitHub Release tarballs are stable references. Direct links to commit SHAs on `main` may not survive across releases.
- **PRs are accepted on the public repo.** They are merged via cherry-pick into the private dev repo, then re-emerge on the public mirror at the next release. Your authorship and commit message are preserved; only the SHA changes.
- **Issues and security advisories** are tracked on the public repo. See [`SECURITY.md`](SECURITY.md) for the security report channel.

The maintainers will move to a non-rewriting model if contribution volume justifies the workflow shift.

</details>
