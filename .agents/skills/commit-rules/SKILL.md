---
name: commit-rules
description: "Keep commit formatting and message structure aligned to repo-specific commit policies"
argument-hint: "status | enforce | template <name>"
---

# SKILL: commit-rules

## Purpose
Keep commit structure and message format consistent for this repository.

## Scope
- Group changes by intent, with one commit per meaningful unit.
- Use the five fixed commit templates established in this session.
- Place documentation commits after functional commits.

## Fixed commit units
1. `feat(backend): add status-time codex auth propagation helper`
   - Refine status endpoint auth exposure path for `/api/status` by extracting a Codex auth helper.
2. `feat(backend): provision oauth provider on each /api/status request`
   - Auto-provision OAuth provider on every `/api/status` call when valid Codex auth is detected.
3. `feat(tray): refresh status before showing popup`
   - Refresh status immediately before showing the tray popup.
4. `feat(tray): normalize tray polling loop with constant interval`
   - Replace inline polling interval with a constant for tray status polling.
5. `docs: describe auth/runtime behavior when codex login is done later`
   - Document runtime behavior when Codex login is completed after process startup.

## Message format
- Use one of the five fixed titles exactly.
- Keep a minimum body with these fields:
  - `Constraint: <external constraint>`
  - `Rejected: <alternative> | <reason>`
  - `Confidence: low|medium|high`
  - `Scope-risk: narrow|moderate|broad`
  - `Directive: <warning for future changes>`
  - `Tested: <verification details>`
  - `Not-tested: <known gaps>`
- Keep the `Co-Authored-By` trailer used in this repository when required.

## Operating flow
- Stage only files relevant to the current commit unit with `git add`.
- Do not mix unrelated intents in one commit.
- Split and commit each unit before moving to the next.
- Place docs commits after all feature commits.

## Checklist
- [ ] Is the commit title one of the five templates?
- [ ] Does each commit contain a single intent?
- [ ] Are required trailers present?
- [ ] Is the docs commit last?
