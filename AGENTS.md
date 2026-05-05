# AGENTS: codex-failover development playbook

This file defines project-local mandatory development guidance.

## 1) Scope
- Applies to runtime and tray integration work in this repository.
- Keep changes scoped by behavior (backend, tray, docs, tests).
- Use `.agents/skills/*` for recurring checks and workflows.

## 2) Backend ↔ Tray communication contract (current)

### Backend
- Backend API runs on `http://127.0.0.1:8787` by default.
  - Host/Port defaults are from shared `DEFAULTS` and can be overridden with `HOST`/`PORT`.
- CLI (`apps/router-backend/src/cli.ts`) starts and supervises:
  - backend server process (`dist/index.js`)
  - tray process (`apps/router-tray/dist/main.js`)
  - PID/log files under user data directory (`server.pid`, `tray.pid`, `server.log`, `tray.log`).
- Core routing mount points:
  - `/api/status` exposes active provider state + `codexAuth` metadata.
  - `/api/providers*` handles provider CRUD, login (`POST /providers/:id/login`), and reorder.
  - `/api/dashboard/*` is used by popup/CLI status output for usage data.
  - `/healthz`, `/readyz` provide server liveness/readiness checks.
- Security gate:
  - `localOriginAuth` enforces local origin for state-changing requests.
  - file:// popup and no-origin clients are allowed.
  - Protected methods: `POST`, `PATCH`, `DELETE`.

### Tray
- Tray process polls API directly in-process:
  - `API_URL = 'http://127.0.0.1:8787/api'`
  - Poll interval: `TRAY_STATUS_POLL_MS = 5_000`.
- Polling flow:
  - `pollStatus()` → `fetch('/status')` → `updateTray(status)`.
  - Popup open flow: `togglePopup()` calls `pollStatus()` before `show()` and emits `refresh`.
- Popup data flow (`apps/router-tray/src/popup.html`):
  - Calls `GET /api/status` and `GET /api/dashboard/usage-today`.
  - Triggers `/providers/:id/login` for `runCodexLogin()`.
  - Triggers `/fallback-state/reset` on reset action.
- Tray→renderer bridge is via `contextBridge`/IPC (`preload.ts`).

## 3) Mandatory local run/verify sequence
Use this for any behavioral change touching backend, tray, or auth/runtime flow.

### Recommended flow
1. Install/build dependencies if needed
   - `pnpm install`
2. Build required targets
   - `pnpm -r --filter @codex-failover/router-backend --filter @codex-failover/router-tray build`
3. Run targeted checks
   - `pnpm --filter @codex-failover/router-backend test:integration`
   - `pnpm --filter @codex-failover/router-backend test:e2e`
   - `pnpm lint`
   - `pnpm typecheck`
4. Launch app and verify runtime
   - `pnpm start` (backend server)
   - `pnpm tray` (tray app)
   - `curl -s http://127.0.0.1:8787/api/status`
   - `codex-failover status` and `codex-failover status --watch`

### Release/build sanity
- `pnpm build`
- `pnpm pack`
- `pnpm publish:dry`

## 4) Validation expectations for new runtime/auth logic
- `/api/status` should reflect auth state changes after login without restarting the backend process.
- Popup should display latest status snapshot when opened.
- Polling should keep running after startup and recover gracefully when backend is unreachable.
- `/api/providers/:id/login` flow should only be triggered by authorized local paths/clients.

## 5) Skill mapping
Use these skills from `.agents/skills` based on intent:
- `commit-rules`: commit unit/title/trailer policy
- `status-runtime-audit`: `/api/status` + auth detection + popup 상태 동기화 검증
- `backend-auth-provision-smoke`: `autoProvisionOAuthProvider` + status-driven 런타임 프로비저닝 검증
- `tray-regression-check`: 트레이 아이콘/툴팁/팝업 갱신/폴링 안정성 검증
- `repo-smoke-verify`: 통합 린트-타입체크-테스트 순차 실행
- `release-pack-publish`: 배포 전 패키지 안정성
- `docs-sync`: 런타임/로그인/빌드 워크플로 문서 반영

## 6) Non-negotiable conventions
- Keep backend and tray communication assumptions explicit in PR descriptions.
- Never mutate auth/tray polling behavior without updating docs and smoke checks.
- Keep commit intent one-to-one with the five commit template policy.
