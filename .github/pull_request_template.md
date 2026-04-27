<!--
  Thanks for contributing! Please fill in this template before
  requesting review. Empty PRs are difficult to triage.
-->

## Summary

<!--
  What does this PR change, and why? Reference any relevant issues
  with `Fixes #123` / `Refs #123`. If this is a UI change, attach a
  screenshot or recording.
-->

## Type of change

<!-- check all that apply -->

- [ ] `feat` — new user-facing capability
- [ ] `fix` — bug fix (non-breaking)
- [ ] `refactor` — internal change with no behavior change
- [ ] `perf` — performance improvement
- [ ] `docs` — documentation only
- [ ] `test` — tests only
- [ ] `ci` — CI / build configuration
- [ ] **breaking change** — requires migration / version bump

## Affected scope

- [ ] Backend (Express API, services, optimizer bridge)
- [ ] Frontend (React SPA)
- [ ] Database schema (`backend/database/init.sql`)
- [ ] Demo seed (`backend/scripts/seed-demo.ts`)
- [ ] CI workflows (`.github/workflows/*`)
- [ ] Documentation (`README.md`, `TECHNICAL.md`, `CONTRIBUTING.md`, ...)

## Test plan

<!--
  How did you verify this? Mention the commands you ran. The CI
  pipeline runs lint + unit tests + build + Playwright e2e.
-->

- [ ] `cd backend && npm run lint && npm test && npm run build`
- [ ] `cd frontend && npm run lint && CI=true npm test -- --watchAll=false && CI=true npm run build`
- [ ] `cd frontend && npm run test:e2e` (against `./scripts/demo.sh up`)
- [ ] Manual smoke test of the affected flow(s)

## Documentation

- [ ] Public API change is reflected in `backend/openapi/openapi.json`
- [ ] User-facing change is reflected in `README.md` (or no doc impact)
- [ ] Architecture change is reflected in `TECHNICAL.md` (or no doc impact)

## Checklist

- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] Branch is up to date with `main`
- [ ] Commits are focused and use the project commit-message format
- [ ] No new ESLint warnings introduced
- [ ] Coverage thresholds still pass locally
