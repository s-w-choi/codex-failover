---
name: tray-regression-check
description: "Regression checks for tray polling, popup refresh, and status icon/tooltip behavior"
argument-hint: "run | steps | report"
---

# SKILL: tray-regression-check

## Purpose
Validate tray lifecycle correctness: popup refresh timing, polling cadence, icon/tooltips, and resilience.

## When to use
- Any tray UI or status polling change.
- Poll interval or status update behavior changed.
- Popup open behavior modified.

## Scope
- `apps/router-tray/src/main.ts`

## Checklist
1. Confirm popup open path calls `pollStatus()` before `show()`.
2. Confirm polling interval uses a single shared constant.
3. Confirm status failures degrade gracefully (`unknown` icon/tooltip behavior).
4. Confirm icon updates follow current status (`active`, `fallback`, `error`, `unknown`).

## Example commands
- `pnpm --filter @codex-failover/router-tray dev`
- Trigger manual popup open/close on supported OS and inspect icon/tooltip transitions.
- `curl -s http://127.0.0.1:8787/api/status | jq`

## Failure conditions
- Popup opens with stale status.
- Poll interval appears hardcoded in multiple places.
- Unknown/error states do not recover after backend becomes available.

## Deliverable
- Regression result table: open-time, poll-time, visible status transitions, failures.
