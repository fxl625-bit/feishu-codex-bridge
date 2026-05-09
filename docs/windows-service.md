# Windows Service Operation

This bridge is designed to run on Windows as a user-scoped background process managed by Task Scheduler.

## One-time install

1. Fill out `.env.local` with the Feishu and Codex settings.
2. Build the bridge:

```powershell
npm run build
```

3. Install the Scheduled Task:

```powershell
npm run service:install
```

That creates a user-scoped task named `FeishuCodexBridge` that starts the bridge at logon and restarts it if the task run fails.

## Day-to-day commands

Start immediately:

```powershell
npm run service:start
```

Stop the running bridge process:

```powershell
npm run service:stop
```

Check task/process/health status:

```powershell
npm run service:status
```

Tail logs:

```powershell
npm run service:logs
powershell -ExecutionPolicy Bypass -File scripts/logs-bridge.ps1 -Stream stderr -Follow
```

Remove the Scheduled Task:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall-bridge-service.ps1
```

## Runtime paths

On this PC, prefer a dedicated `F:\CODEX` runtime root so task/session/log files do not accumulate on `C:`.

Recommended `.env.local` overrides:

```env
CODEX_WORKSPACE_ROOT=F:\CODEX\workspaces\feishu-codex
BRIDGE_SERVICE_BASE_DIR=F:\CODEX\feishu-codex-bridge
BRIDGE_DATA_DIR=F:\CODEX\feishu-codex-bridge\data
BRIDGE_LOG_DIR=F:\CODEX\feishu-codex-bridge\logs
BRIDGE_RUN_DIR=F:\CODEX\feishu-codex-bridge\run
BRIDGE_CONVERSATIONS_DIR=F:\CODEX\feishu-codex-bridge\conversations
```

With that layout, the bridge keeps runtime state under `F:\CODEX\feishu-codex-bridge`:

- Task store: `F:\CODEX\feishu-codex-bridge\data\tasks.json`
- Conversation store: `F:\CODEX\feishu-codex-bridge\data\conversations.json`
- Conversation transcripts: `F:\CODEX\feishu-codex-bridge\conversations\`
- Stdout log: `F:\CODEX\feishu-codex-bridge\logs\bridge.stdout.log`
- Stderr log: `F:\CODEX\feishu-codex-bridge\logs\bridge.stderr.log`
- PID file: `F:\CODEX\feishu-codex-bridge\run\bridge.pid`
- Health check: `http://127.0.0.1:8787/health` unless `PORT` is overridden

Override directories with absolute paths in `.env.local` if needed:

```env
BRIDGE_SERVICE_BASE_DIR=D:\Bridge
BRIDGE_DATA_DIR=D:\Bridge\data
BRIDGE_LOG_DIR=D:\Bridge\logs
BRIDGE_RUN_DIR=D:\Bridge\run
```

## Notes

- The health server binds only to `127.0.0.1`.
- `service:start` is idempotent and will not spawn a second bridge if the PID file still points at a live process.
- After any code change that affects `dist\index.js` or its imports, `npm run build` is not enough by itself. You must restart the running bridge with `npm run service:stop` and `npm run service:start`, otherwise Feishu traffic may keep executing the old in-memory Node process.
- Verified pitfall on 2026-05-09: local `sessions:ask` can pass after a rebuild while Feishu-triggered tasks still fail if the background bridge process was started before the new `dist` files were built. In this repo that showed up as `Not inside a trusted directory and --skip-git-repo-check was not specified.` even though the new `dist\codex-runner.js` already contained `--skip-git-repo-check`.
- When diagnosing that mismatch, compare three things together: the `dist` file timestamp, the bridge process creation time from `wmic process ... get CreationDate,CommandLine`, and the latest conversation transcript entry under `F:\CODEX\feishu-codex-bridge\conversations\`.
- If the bridge exits immediately, check `bridge.stderr.log` first.
- The upgraded operating model is session-first: operators should expect one local conversation record per Feishu chat, not only per-task status tracking.
- Feishu session commands are designed to include `/session`, `/sessions`, and `/history [count]` so recent conversation state is visible without digging through `tasks.json`.
- The PC continuation workflow is intended to resume an existing Feishu chat locally, then send the follow-up result back through the same transport path.
- Obsidian archive sync is best-effort. If `F:\obsidian\...` is unavailable, local bridge execution should continue using `%LOCALAPPDATA%\feishu-codex-bridge` as the authoritative runtime store.
