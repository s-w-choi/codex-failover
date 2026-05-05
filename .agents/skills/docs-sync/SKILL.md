# SKILL: docs-sync

## Purpose
Keep documentation aligned with auth/runtime behavior and CLI/Tray workflow changes.

## When to use
- Feature changes affect user-facing startup/login/runtime behavior.
- Polling or popup behavior changed.
- New prerequisites are added in scripts or setup flows.

## Scope
- `README.md`
- `docs/`
- Related package/app docs if any.

## Workflow
1. Map touched runtime behavior to one user-visible doc section.
2. Update docs with before/after behavior, especially auth-time and refresh timing assumptions.
3. Verify command names, env vars, ports, and endpoints still match implementation.
4. Add/adjust docs asset references if UI behavior changed.

## Checklist
- [ ] New/changed behavior appears in `README.md` or dedicated doc file.
- [ ] Endpoint names and ports verified.
- [ ] Late-login/auth-refresh path documented if changed.
- [ ] Screenshot or flow notes updated for tray UI behavior if needed.

## Deliverable
- A docs diff summary with file list and rationale.
