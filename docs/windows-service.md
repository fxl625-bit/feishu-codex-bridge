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
- Native session binding store: `F:\CODEX\feishu-codex-bridge\data\native-sessions.json`
- Stdout log: `F:\CODEX\feishu-codex-bridge\logs\bridge.stdout.log`
- Stderr log: `F:\CODEX\feishu-codex-bridge\logs\bridge.stderr.log`
- PID file: `F:\CODEX\feishu-codex-bridge\run\bridge.pid`
- Native worker artifacts: `F:\CODEX\feishu-codex-bridge\run\`
- Health check: `http://127.0.0.1:8787/health` unless `PORT` is overridden

Override directories with absolute paths in `.env.local` if needed:

```env
BRIDGE_SERVICE_BASE_DIR=D:\Bridge
BRIDGE_DATA_DIR=D:\Bridge\data
BRIDGE_LOG_DIR=D:\Bridge\logs
BRIDGE_RUN_DIR=D:\Bridge\run
```

## Native Session Worker Model

The service should now be operated as a shared native-session worker host rather than a one-shot `codex exec` relay:

- One Feishu `chatId` maps to one bridge-owned Codex-native session binding.
- The bridge reuses that binding until it has been idle for 24 hours.
- After 24 hours of inactivity, the next message should create a fresh native session and update the binding store.
- Feishu-visible behavior stays final-answer-only. Operators should not expect queue acknowledgements or intermediate worker output in chat.

The bridge-owned binding registry is authoritative for Feishu routing even if Codex-native session files disappear or become non-resumable. Recovery behavior should recreate the binding instead of leaving the chat stuck on a dead native session id.

## Restart Rules After Runtime Changes

Any change to runtime code that touches worker creation, session resume logic, final-message extraction, or runtime path handling requires a full service restart after build:

```powershell
npm run build
npm run service:stop
npm run service:start
npm run service:status
```

Do not treat a rebuilt `dist` directory, a passing local CLI test, or an old healthy PID alone as proof that the live Feishu-facing worker process has picked up native-session changes.

## Visibility Verification

Shared native sessions are only useful operationally if the same machine can correlate bridge bindings with Codex-native storage. Verify that explicitly:

1. Check the bridge binding store under `F:\CODEX\feishu-codex-bridge\data\native-sessions.json`.
2. Inspect local Codex-native storage under `C:\Users\yckj0094\.codex\`, especially `sessions\` and `session_index.jsonl`.
3. Try resuming the session from Codex CLI using the installed native resume command surface, for example `codex resume <session-id>` if available.
4. Check Codex desktop history and the VS Code Codex surface on the same machine for the same session id or matching metadata.

Treat step 4 as a verification target, not a guaranteed invariant. Product visibility can vary by Codex client version and by whether those clients are actually reading the same local storage.

## Notes

- The health server binds only to `127.0.0.1`.
- `service:start` is idempotent and will not spawn a second bridge if the PID file still points at a live process.
- On this PC as of 2026-05-11, Scheduled Task registration was blocked by local policy or permissions and `service:install` fell back to the Startup script at `C:\Users\yckj0094\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\FeishuCodexBridge.cmd`.
- After any code change that affects `dist\index.js` or its imports, `npm run build` is not enough by itself. You must restart the running bridge with `npm run service:stop` and `npm run service:start`, otherwise Feishu traffic may keep executing the old in-memory Node process.
- Verified pitfall on 2026-05-09: local `sessions:ask` can pass after a rebuild while Feishu-triggered tasks still fail if the background bridge process was started before the new `dist` files were built. In this repo that showed up as `Not inside a trusted directory and --skip-git-repo-check was not specified.` even though the new `dist\codex-runner.js` already contained `--skip-git-repo-check`.
- When diagnosing that mismatch, compare three things together: the `dist` file timestamp, the bridge process creation time from `wmic process ... get CreationDate,CommandLine`, and the latest conversation transcript entry under `F:\CODEX\feishu-codex-bridge\conversations\`.
- If the bridge exits immediately, check `bridge.stderr.log` first.
- The upgraded operating model is session-first: operators should expect one local conversation record per Feishu chat, not only per-task status tracking.
- For the native-worker upgrade, operators should also expect one bridge-owned native session binding per Feishu chat, with 24-hour idle expiry from the last successful use.
- Feishu session commands are designed to include `/session`, `/sessions`, and `/history [count]` so recent conversation state is visible without digging through `tasks.json`.
- The PC continuation workflow is intended to resume an existing Feishu chat locally, then send the follow-up result back through the same transport path.
- Obsidian archive sync is best-effort. If `F:\obsidian\...` is unavailable, local bridge execution should continue using `%LOCALAPPDATA%\feishu-codex-bridge` as the authoritative runtime store.
- Verified caveat on 2026-05-11: a bridge-created native session can be resumable from Codex CLI while still not appearing in `session_index.jsonl` right away. Treat Desktop and VS Code conversation visibility as a machine-specific verification item, not as a guaranteed outcome.
