# Feishu Codex Bridge

Control Codex CLI from Feishu messages on a Windows PC and receive replies back in Feishu.

The bridge now supports a local-visible, resumable native-session flow: each Feishu `chatId` maps to a stable Codex-native session worker that can be inspected on the PC, resumed locally, and synced into the canonical archive.

v1.0 freeze:
- Desktop visibility now depends on session files, `session_index.jsonl`, and `.codex-global-state.json` workspace hints.
- Keep `F:\CODEX\workspaces\feishu-codex` as the canonical workspace root for this bridge.
- Restart the bridge service after code changes.

## Planned MVP

- Receive Feishu bot messages over long connection mode
- Parse `/ask`, `/run`, and `/status` commands
- Execute Codex CLI jobs locally with guardrails
- Reply with task status and summarized results
- Persist lightweight task history locally

## Native Session Workers

The bridge is moving away from per-message cold-start `codex exec` runs. In the native-worker model:

- Each Feishu `chatId` is the stable key for one shared Codex-native session binding.
- The bridge reuses that native session until it has been idle for 24 hours, then starts a fresh one on the next message.
- Feishu replies remain final-answer-only. The bridge should not send queue banners, intermediate transcript chunks, or other execution noise back into chat.
- Shared native-session visibility is a goal, not an assumption. When the bridge and local Codex clients use the same session storage, the session should be resumable from Codex CLI and may become visible in Codex desktop or VS Code, but operators must verify that behavior on the actual machine.

## Local Runtime Artifacts

For this PC, the recommended layout is a dedicated `F:\CODEX` workspace so runtime files do not accumulate on `C:`.

Recommended paths:

- Codex task workspace: `F:\CODEX\workspaces\feishu-codex`
- Bridge runtime root: `F:\CODEX\feishu-codex-bridge`

With that layout, the bridge keeps session state under `F:\CODEX\feishu-codex-bridge`:

- Task store: `F:\CODEX\feishu-codex-bridge\data\tasks.json`
- Conversation store: `F:\CODEX\feishu-codex-bridge\data\conversations.json`
- Conversation transcripts: `F:\CODEX\feishu-codex-bridge\conversations\`
- Native session bindings: `F:\CODEX\feishu-codex-bridge\data\native-sessions.json`
- Native worker run artifacts: `F:\CODEX\feishu-codex-bridge\run\`

## Local development

Project setup and implementation are tracked under `docs/superpowers/`.

1. Copy `.env.example` values into `.env.local`.
2. Fill `ALLOWED_OPEN_IDS` with the Feishu `open_id` values that are allowed to control the bridge.
3. Start the bridge with `npm run dev`.
4. Check the local health endpoint at `http://127.0.0.1:8787/health`.

## Windows service mode

For long-running Windows usage, use the repo-owned Task Scheduler scripts in [docs/windows-service.md](/C:/Users/yckj0094/Documents/Codex/2026-05-07/pc-codex/docs/windows-service.md).

```powershell
npm run build
npm run service:install
npm run service:start
npm run service:status
```

When you change bridge runtime code, rebuild and then restart the background bridge. A fresh `dist` alone does not update the already-running Node service:

```powershell
npm run build
npm run service:stop
npm run service:start
```

This restart requirement applies directly to native session workers. If runtime code changes while the background bridge is still running, Feishu traffic may continue to use the old in-memory worker behavior even after a successful rebuild.

## Commands

- Plain text: treated as `/ask`
- `/ask <prompt>`: read-only Codex task
- `/run <prompt>`: writable Codex task inside `CODEX_WORKSPACE_ROOT`
- `/status [task-id]`: fetch latest task state
- `/session`: show the current chat's local session
- `/sessions`: list recent sessions for the current user
- `/history [count]`: show recent turns from the current chat
- `/help`: print command help

## PC Continuation Workflow

Use the local session CLI to continue an existing Feishu conversation from the PC and send the result back into the same Feishu chat:

- `npm run sessions:list`
- `npm run sessions:show -- <session-id>`
- `npm run sessions:ask -- <session-id> <prompt>`
- `npm run sessions:run -- <session-id> <prompt>`

For native-session verification, also confirm the underlying Codex-native session can be resumed from the same machine. The exact command surface depends on the installed Codex client version, but operators should verify at least:

- the bridge-side session binding under `F:\CODEX\feishu-codex-bridge\data\native-sessions.json`
- the matching native session metadata under `C:\Users\yckj0094\.codex\`
- local resume behavior with a native Codex command such as `codex resume <session-id>` if the installed CLI exposes that entry point

If shared storage is working, check whether the same session is visible in Codex CLI session listings, Codex desktop session history, and the VS Code Codex extension or panel. Treat discoverability in those surfaces as machine-specific verified behavior, not as guaranteed product behavior.

## Archive Sync

The canonical archive root remains `F:\obsidian\wiki\raw\AI-projects\feishu-codex-bridge`.

Obsidian sync is best-effort only. If `F:` is unavailable, the bridge should not block task execution, but this machine is intentionally configured to keep its active bridge workspace on `F:\CODEX` rather than `C:`.
