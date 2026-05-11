# Changelog

All notable changes to this project are documented here.

## Changelog Rules

1. Add upcoming changes to `Unreleased` first.
2. At release time, move `Unreleased` into `## [x.y.z] - YYYY-MM-DD`.
3. Keep the newest release section at the top and clear the staged area afterward.
4. Use only `Added`, `Changed`, and `Fixed` categories.
5. Place newest release sections first, descending by version.

## [Unreleased]

### Added
- None yet.

### Changed
- None yet.

### Fixed
- None yet.

## [0.0.3] - 2026-05-11

### Added
- Added changelog workflow skill documentation to standardize release-note authoring and compliance.
- Added dedicated tray popup script/style modules (`popup-logic.js`, `popup-render.js`, `popup.css`) to split responsibilities and simplify future UI changes.

### Changed
- Updated `/api/status`-driven auth/runtime behavior for provider provisioning and status reporting consistency.
- Refined tray runtime + popup integration for status/login flow and popup behavior.
- Expanded backend integration/e2e/unit test coverage around Codex auth provisioning and dashboard/status behavior.

### Fixed
- Fixed README/process guidance by aligning runtime validation and verification expectations with new status/auth behavior.
- Fixed regression coverage gaps for OAuth login/config scenarios and dashboard usage/status checks.

## [0.0.2] - 2026-05-11

### Added
- Initial release of `codex-failover` with local backend/tray architecture.
- Added provider failover routing with priority and health checks.
- Added local CLI commands for install/start/stop/restart/status/logs and restore/uninstall flows.
- Added desktop tray app with popup status and provider management UI bridge.
- Added runtime/auth integration and usage tracking for dashboard/monitoring.
- Added repository CI/build/test tooling (`make`, `pnpm` workspaces).

### Changed
- None yet.

### Fixed
- None yet.

## [0.0.1] - 2026-05-10

### Added
- Built the first full release-capable backend/tray platform with routing, usage tracking, and Codex auth support.
- Added shared routing, provider management, dashboard, health, and CLI foundations.
- Added tray package with popup rendering, tray icon lifecycle, and basic polling.
- Added Codex session mapping tests and provider alias support.
- Added project-level documentation and workflow scripts for CI, release, and verification.

### Changed
- None yet.

### Fixed
- Refined ID-based usage matching to improve provider session mapping reliability.
