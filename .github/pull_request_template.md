<!--
  Thanks for contributing! Please fill in this template before
  requesting review. Empty PRs are difficult to triage.
-->

## Summary

<!--
  What does this PR change, and why? Every PR belongs to an issue:
  reference it with `Closes #123` (or `Refs #123` when it does not complete
  it). If this is a UI change, attach a screenshot or recording.
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
- [ ] `chore` — tooling, dependencies
- [ ] **breaking change** — requires migration / version bump

## Affected scope

- [ ] Backend (Express API, services, optimizer bridge)
- [ ] Frontend (React SPA)
- [ ] Shared contract (`packages/shared`)
- [ ] Optimizer (`backend/optimization-scripts/`, `backend/src/optimization/`)
- [ ] Mobile wrapper (`mobile/`)
- [ ] Database schema (`backend/db/migrations/`)
- [ ] Demo seed (`backend/scripts/seed-demo.ts`)
- [ ] Deployment / operations (`docker-compose*.yml`, `ops/`)
- [ ] CI workflows (`.github/workflows/*`)
- [ ] Documentation (`README.md`, `DOCUMENTATION.md`, `.github/CONTRIBUTING.md`)

## Test plan

<!--
  How did you verify this? Mention the commands you ran. The full gate
  is in .github/CONTRIBUTING.md ("The local gate").
-->

- [ ] Backend: `npm run lint && npm run typecheck && npm run deadcode && npm run deadcode:cycles && npm run build && REQUIRE_ORTOOLS=1 npm run test:coverage`
- [ ] Frontend: `npm run lint && npx tsc --noEmit && npm run deadcode && npm run test:coverage && npm run build`
- [ ] Suites pass off UTC (`TZ=America/Los_Angeles npx jest`, `TZ=Pacific/Auckland npx jest`)
- [ ] `cd frontend && npm run test:e2e` (against `./scripts/demo.sh up`)
- [ ] Manual smoke test of the affected flow(s)

## Documentation

- [ ] Contract change regenerated: `npm run openapi:generate` (backend) then `npm run api:generate` (frontend), both committed
- [ ] Endpoint, behaviour or architecture change is reflected in `DOCUMENTATION.md` (or no doc impact)
- [ ] User-facing change is reflected in `README.md` (or no doc impact)
- [ ] Table or required-column change is reflected in the demo seed

## Checklist

- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] Branch is up to date with `main`
- [ ] Commits are focused and use the project commit-message format
- [ ] No new ESLint warnings introduced
- [ ] New behaviour is covered by tests that assert outcomes, including failure paths
- [ ] Coverage thresholds still pass locally
