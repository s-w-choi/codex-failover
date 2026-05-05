# SKILL: repo-smoke-verify

## Purpose
Run repo-wide smoke verification in a consistent order and capture regressions early.

## When to use
- Before merging feature changes.
- After backend/tray/docs edits that may affect integration behavior.
- Before running packaging/publishing steps.

## Scope
- Root scripts in `package.json`
- `apps/router-backend`
- `apps/router-tray`
- `packages/*`

## Mandatory order
1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test:unit`
4. `pnpm test:integration`
5. `pnpm test:e2e`

## Example commands
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm test:e2e`

## Failure conditions
- Any step fails (stop and triage before next step).
- Test output missing auth-status assertions after `/api/status` behavior changes.

## Deliverable
- A compact verification log with first failing command and root-cause candidate.
