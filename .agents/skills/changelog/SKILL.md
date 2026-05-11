---
name: changelog
description: "[OMX] Maintain release notes in docs/CHANGELOG.md and enforce release-entry rules"
argument-hint: "init | status | add | release <version> [--date YYYY-MM-DD] | enforce"
---

# SKILL: changelog

## Purpose
Manage changelog updates for this repository in `docs/CHANGELOG.md` and keep versioning rules consistent for every release.

## Scope
- File target: `docs/CHANGELOG.md`
- Project rule file: `README.md` changelog section
- Workflow scope: release-note drafting, release cutover, and compliance checks

## Required rules
1. Collect all changes for the next release in `## [Unreleased]` first.
2. Before version bump, move `Unreleased` items into `## [x.y.z] - YYYY-MM-DD`.
3. Keep the changelog ordered with the newest version section at the top.
4. Track entries using only `### Added`, `### Changed`, and `### Fixed` categories.
5. Keep `Unreleased` after release cutover clean for the next cycle.

## Workflow

### 1) `changelog init`

Create `docs/CHANGELOG.md` if it does not exist and ensure this baseline exists:

```md
# Changelog

## [Unreleased]

### Added
### Changed
### Fixed
```

If the file already exists, create only the missing sections.

### 2) `changelog status`

Check and report:
- Presence of `Unreleased` and its categories.
- Whether newest release section is `## [x.y.z] - YYYY-MM-DD`.
- Whether releases are ordered from newest to oldest.

### 3) `changelog add`

Add one release note to `Unreleased`.

Usage:
- `changelog add --type Added "text"`
- `changelog add --type Changed "text"`
- `changelog add --type Fixed "text"`

If `--type` is omitted, default to `Added`.

### 4) `changelog release <version>`

Move staged items from `Unreleased` into a new release section:
- `changelog release 0.1.0 --date 2026-05-11`

Rules:
- `version` is required (`0.1.0`).
- Optional `--date`; default uses current date.
- Create/replace `## [version] - YYYY-MM-DD` as the newest top release section.
- Keep `Unreleased` section for the next cycle.

### 5) `changelog enforce`

Validate changelog compliance:
- `Unreleased` exists and is staging-only.
- Release headings follow `## [x.y.z] - YYYY-MM-DD`.
- Latest release heading is first among release entries.
- Entries use `Added`, `Changed`, `Fixed`.

If any rule is violated, block release and request correction.

## Output examples

- `changelog add --type Added "Add OAuth status auto-provisioning in /api/status path."`
- `changelog release 0.0.3 --date 2026-05-11`
