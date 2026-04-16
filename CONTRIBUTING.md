# Contributing to ClawLens

> **Status:** Initial draft -- under review

Thanks for your interest in contributing to ClawLens. This guide covers everything you need to get started.

## Getting Started

```bash
<!-- TODO: Replace <org> with actual GitHub org once decided -->
git clone https://github.com/<org>/clawLens.git
cd clawLens
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

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) code of conduct.
