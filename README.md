# codex-failover

Local failover router for Codex/OpenAI-compatible requests.

<p align="center">
  <img src="./docs/active.png" width="120" />
  <img src="./docs/fallback.png" width="120" />
  <img src="./docs/error.png" width="120" />
  <img src="./docs/unknown.png" width="120" />
</p>

`codex-failover` runs on your machine and routes requests across multiple providers. If the current provider rate-limits, fails, or hits budget limits, the router automatically switches to the next healthy provider.

This repository is tray + backend only:

- Backend API/CLI (`apps/router-backend`)
- Desktop tray client (`apps/router-tray`)

## Why this project

- Keep Codex sessions running when one provider fails.
- Route by priority, cost, and latency.
- Enforce per-provider limits (requests, tokens, budget).
- Keep traffic local (`127.0.0.1`) and preserve OAuth pass-through behavior.

## Repository layout

- `apps/router-backend` - API server and CLI (`codex-failover`)
- `apps/router-tray` - desktop tray client
- `packages/*` - shared libraries (routing, credential store, usage tracker, test harness)

## Requirements

- **OS**: `macOS` or `Linux`. Not supported on Windows (uses `lsof`, `pkill`, and Unix shell commands).
- **Node.js**: v20 or later.
- **pnpm**: v9 (auto-installed by `make install` if missing).

## Quick start (recommended)

### 1) Clone and install

```bash
git clone https://github.com/s-w-choi/codex-failover.git
cd codex-router
make install
```

`make install` performs:

- dependency install (`pnpm`)
- full build
- CLI link (`codex-failover`)
- Codex config patch (`codex-failover install`)

### AI setup prompt (after `make install`)

Paste this prompt into Codex (or another coding agent) right after `make install`:

```text
You are in the codex-failover repository.
`make install` already finished.

Goal:
Finish codex-failover runtime setup and make it immediately usable for Codex CLI.

Do this now:
1. Start the service stack (backend + tray) with the repo's standard command.
2. Verify codex-failover is reachable and healthy.
3. Confirm Codex is configured to use the local router (`http://127.0.0.1:8787/v1`).
4. Run a minimal smoke test command and show the exact command to run next.
5. If anything fails, fix it and retry until it works.

Output format:
- What you ran
- Current status
- Next command for me to run
```

### 2) Start backend + tray

```bash
codex-failover start
```

Default API endpoint used by Codex:

- `http://127.0.0.1:8787/v1`

Root (`http://127.0.0.1:8787`) is API status JSON (no web dashboard page).

### 3) Verify status

```bash
codex-failover status
```

### 4) Use Codex as usual

```bash
codex "hello"
```

## Core commands

### Make targets

```bash
make help
make install
make start
make stop
make dev
make test
make verify
```

### CLI commands

```bash
codex-failover start
codex-failover stop
codex-failover restart
codex-failover status
codex-failover status --watch
codex-failover logs
codex-failover install
codex-failover restore
```

## Codex configuration flow

If you did not run `make install`, run this manually:

```bash
codex-failover install
```

This updates your `~/.codex/config.toml` to use the local router. To roll back:

```bash
codex-failover restore
```

## Environment variables

| Variable                        | Default              | Description                   |
| ------------------------------- | -------------------- | ----------------------------- |
| `PORT`                          | `8787`               | Router API port               |
| `HOST`                          | `127.0.0.1`          | Bind address                  |
| `CODEX_FAILOVER_PROVIDERS_FILE` | unset                | Optional providers JSON path  |
| `CODEX_FAILOVER_DATA_DIR`       | `~/.codex-failover/` | Optional local data directory |

## Development

```bash
pnpm install
pnpm build
pnpm dev
```

## Testing and quality gates

```bash
make test
make verify
```

## Security notes

- Bind to localhost only (`127.0.0.1`).
- Do not expose this service directly to the internet.
- Keep `.env`, local runtime state, and private planning docs out of git.

## License

MIT. See `LICENSE`.
