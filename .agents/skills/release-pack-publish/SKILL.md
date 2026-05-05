# SKILL: release-pack-publish

## Purpose
Prepare a safe publish pre-check and reduce package-release mistakes.

## When to use
- Before `npm publish` or `publish:dry`.
- After changing shared package APIs or build pipeline.

## Scope
- `package.json`
- `pnpm-lock.yaml`
- publish-relevant apps/packages touched by changed feature.

## Workflow
1. Confirm workspace build health:
   - `pnpm build`
2. Pack artifacts and inspect outputs:
   - `pnpm pack`
3. Run dry publish:
   - `pnpm publish:dry`
4. Verify package metadata (name/version/files/readme entry points).
5. Only proceed to real publish after owner approval.

## Example commands
- `pnpm build`
- `pnpm pack`
- `pnpm publish:dry`

## Failure conditions
- Build fails in any workspace package.
- Generated tarball includes missing/incorrect entry files.
- Version mismatch between intended release and package metadata.

## Deliverable
- A publish readiness checklist with pass/fail for build, pack, and dry-run outputs.
