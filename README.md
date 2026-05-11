# codex-failover

Local failover router for Codex/OpenAI-compatible requests.

<p align="center">
  <img src="https://raw.githubusercontent.com/s-w-choi/codex-failover/main/docs/active.png" width="120" />
  <img src="https://raw.githubusercontent.com/s-w-choi/codex-failover/main/docs/fallback.png" width="120" />
  <img src="https://raw.githubusercontent.com/s-w-choi/codex-failover/main/docs/error.png" width="120" />
  <img src="https://raw.githubusercontent.com/s-w-choi/codex-failover/main/docs/unknown.png" width="120" />
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

## Install

### From npm (preferred for release users)

```bash
npm install -g @sungwon_choi/codex-failover
```

Then run:

```bash
codex-failover --help
codex-failover install
```

This installs the published package to your PATH and sets up the Codex config.

## Setup and run

```bash
npm install -g @sungwon_choi/codex-failover
codex-failover install
codex-failover start
```

Default API endpoint used by Codex:

- `http://127.0.0.1:8787/v1`

Root (`http://127.0.0.1:8787`) is API status JSON (no web dashboard page).

## Core commands

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
codex-failover uninstall
```

## Codex configuration flow

If you have not configured Codex routing yet, run this manually:

```bash
codex-failover install
```

This updates your `~/.codex/config.toml` to use the local router. To roll back:

```bash
codex-failover restore
```

## Uninstall

To completely remove codex-failover (stops processes, restores config, deletes data):

```bash
codex-failover uninstall
npm uninstall -g @sungwon_choi/codex-failover
```

## Development

If you are developing or testing from source, use the repo workflow:

```bash
git clone https://github.com/s-w-choi/codex-failover.git
cd codex-router
make install
```

Then run local build/verification:

```bash
pnpm install
pnpm build
make dev
make test
make verify
```
## Environment variables

| Variable                        | Default              | Description                   |
| ------------------------------- | -------------------- | ----------------------------- |
| `PORT`                          | `8787`               | Router API port               |
| `HOST`                          | `127.0.0.1`          | Bind address                  |
| `CODEX_FAILOVER_PROVIDERS_FILE` | unset                | Optional providers JSON path  |
| `CODEX_FAILOVER_DATA_DIR`       | `~/.codex-failover/` | Optional local data directory |

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
