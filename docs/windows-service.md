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

On a Windows PC, prefer a dedicated workspace drive so task/session/log files do not accumulate on the system drive.

Recommended `.env.local` overrides:

```env
CODEX_WORKSPACE_ROOT=<workspace-root-path>
BRIDGE_SERVICE_BASE_DIR=<bridge-runtime-root>
BRIDGE_DATA_DIR=<bridge-runtime-root>\data
BRIDGE_LOG_DIR=<bridge-runtime-root>\logs
BRIDGE_RUN_DIR=<bridge-runtime-root>\run
BRIDGE_CONVERSATIONS_DIR=<bridge-runtime-root>\conversations
```

With that layout, the bridge keeps runtime state under the configured directories:

- Task store: `<DATA_DIR>\tasks.json`
- Conversation store: `<DATA_DIR>\conversations.json`
- Conversation transcripts: `<CONVERSATIONS_DIR>\`
- Native session binding store: `<DATA_DIR>\native-sessions.json`
- Stdout log: `<LOG_DIR>\bridge.stdout.log`
- Stderr log: `<LOG_DIR>\bridge.stderr.log`
- PID file: `<RUN_DIR>\bridge.pid`
- Native worker artifacts: `<RUN_DIR>\`
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

1. Check the bridge binding store under `<DATA_DIR>\native-sessions.json`.
2. Inspect local Codex-native storage under `%USERPROFILE%\.codex\`, especially `sessions\` and `session_index.jsonl`.
3. Try resuming the session from Codex CLI using the installed native resume command surface, for example `codex resume <session-id>` if available.
4. Check Codex desktop history and the VS Code Codex surface on the same machine for the same session id or matching metadata.

Treat step 4 as a verification target, not a guaranteed invariant. Product visibility can vary by Codex client version and by whether those clients are actually reading the same local storage.

## Notes

- The health server binds only to `127.0.0.1`.
- `service:start` is idempotent and will not spawn a second bridge if the PID file still points at a live process.
- If Task Scheduler registration is blocked by local policy or permissions, `service:install` falls back to a Startup script at `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\FeishuCodexBridge.cmd`.
- After any code change that affects `dist\index.js` or its imports, `npm run build` is not enough by itself. You must restart the running bridge with `npm run service:stop` and `npm run service:start`, otherwise Feishu traffic may keep executing the old in-memory Node process.
- Verified pitfall: local `sessions:ask` can pass after a rebuild while Feishu-triggered tasks still fail if the background bridge process was started before the new `dist` files were built. This shows up as `Not inside a trusted directory and --skip-git-repo-check was not specified.` even though the new `dist\codex-runner.js` already contained `--skip-git-repo-check`.
- When diagnosing that mismatch, compare three things together: the `dist` file timestamp, the bridge process creation time from `wmic process ... get CreationDate,CommandLine`, and the latest conversation transcript entry under `<CONVERSATIONS_DIR>\`.
- If the bridge exits immediately, check `bridge.stderr.log` first.
- The upgraded operating model is session-first: operators should expect one local conversation record per Feishu chat, not only per-task status tracking.
- For the native-worker upgrade, operators should also expect one bridge-owned native session binding per Feishu chat, with 24-hour idle expiry from the last successful use.
- Feishu session commands are designed to include `/session`, `/sessions`, and `/history [count]` so recent conversation state is visible without digging through `tasks.json`.
- The PC continuation workflow is intended to resume an existing Feishu chat locally, then send the follow-up result back through the same transport path.
- Obsidian archive sync is best-effort. If the archive directory is unavailable, local bridge execution should continue using the runtime store configured in `.env.local`.
- Verified caveat: a bridge-created native session can be resumable from Codex CLI while still not appearing in `session_index.jsonl` right away. Treat Desktop and VS Code conversation visibility as a machine-specific verification item, not as a guaranteed outcome.
