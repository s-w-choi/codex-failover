---
name: status-runtime-audit
description: "Audit /api/status and tray status propagation behavior end-to-end"
argument-hint: "run | capture <scenario> | report"
---

# SKILL: status-runtime-audit

## Purpose
Validate backend status/auth runtime behavior end-to-end from polling to tray/state propagation.

## When to use
- `/api/status` behavior changed.
- Codex login is moved to be supported after process start.
- Tray behavior appears stale or inconsistent.

## Scope
- `apps/router-backend/src/routes/admin.ts`
- `apps/router-backend/src/services/codex-auth-detector.ts`
- `apps/router-tray/src/main.ts`

## Required checks
1. Start backend and tray with local stack.
2. Verify `/api/status` response includes `codexAuth` fields.
3. Simulate no-auth state, then perform `codex login`.
4. Poll `/api/status` and confirm auth is detected and runtime state updates without restart.
5. Open tray popup and confirm latest status is reflected immediately.

## Example commands
- `pnpm --filter @codex-failover/router-backend dev`
- `pnpm --filter @codex-failover/router-tray dev`
- `curl -s http://127.0.0.1:8787/api/status | jq`
- `curl -X POST http://127.0.0.1:8787/api/providers/<id>/login -H 'Content-Type: application/json' -d '{}'`

## Failure conditions
- Status response does not change after later `codex login`.
- Tray popup opens with stale status.
- Auth detector output missing expected fields (`detected`, `isExpired`, `accountId`).

## Deliverable
- A short report with request/response snapshots before and after login, and tray behavior proof.
