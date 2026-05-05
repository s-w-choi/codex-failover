# Codex auth and runtime refresh behavior

## `/api/status` and late `codex login`

The backend now checks Codex auth state on every `/api/status` request through `CodexAuthDetector`.

When a valid, non-expired login is detected, the backend provisions the OAuth provider (`autoProvisionOAuthProvider`) and refreshes active runtime routing state.

This means a user can log in to Codex after the backend started; no restart is required for routing/auth status propagation to happen, because the next status poll/update triggers the provisioning path.

## Tray behavior

The tray now refreshes status immediately before opening popup so the popup reflects the latest runtime state.

Tray polling uses a normalized interval constant (`TRAY_STATUS_POLL_MS`) for status refresh so cadence is easy to adjust consistently.
