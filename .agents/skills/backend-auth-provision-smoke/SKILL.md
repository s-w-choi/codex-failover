---
name: backend-auth-provision-smoke
description: "Smoke-test OAuth provider auto-provision during status polling/auth detection"
argument-hint: "run | verify | report"
---

# SKILL: backend-auth-provision-smoke

## Purpose
Create and run a repeatable smoke workflow for OAuth provider auto-provision on status polling.

## When to use
- `/api/status` or `CodexAuthDetector` behavior changed.
- `ProviderRegistry.autoProvisionOAuthProvider` touched.
- A regression appears in dashboard/runtime sync after login.

## Scope
- `apps/router-backend/src/routes/admin.ts`
- `apps/router-backend/src/services/codex-auth-detector.ts`
- `apps/router-backend/src/services/provider-registry.ts`
- `apps/router-backend/tests/**/*.test.ts`

## Workflow
1. Capture baseline: ensure backend tests related to provider registry/auth are passing.
2. Add/adjust test for status call path with:
   - non-authenticated state
   - authenticated state (mocked `CodexAuthDetector.detect`)
   - expired auth state
3. Ensure idempotent behavior when `/api/status` is called repeatedly.
4. Confirm routing/config switcher updates only on actual provisioning.

## Example commands
- `pnpm --filter @codex-failover/router-backend test:unit`
- `pnpm --filter @codex-failover/router-backend test:integration`
- `pnpm --filter @codex-failover/router-backend test:e2e`

## Failure conditions
- `autoProvisionOAuthProvider` not called after login detection.
- Provisioning not idempotent (duplicate providers or unstable reroute).
- `syncConfigToActiveProvider` side effects happen incorrectly on no-op status checks.

## Deliverable
- Test assertions and one short changelog note tied to auth provision semantics.
