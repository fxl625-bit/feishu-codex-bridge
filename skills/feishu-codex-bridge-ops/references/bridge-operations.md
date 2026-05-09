# Bridge Operations

## Startup Checklist

1. Confirm `.env.local` has:
   - `FEISHU_APP_ID`
   - `FEISHU_APP_SECRET`
   - `ALLOWED_OPEN_IDS`
   - `CODEX_WORKSPACE_ROOT`
2. Keep `CODEX_WORKSPACE_ROOT` absolute on Windows.
3. For local interactive development:
   - `npm run dev`
4. For long-running local service mode:
   - `npm run build`
   - `npm run service:install`
   - `npm run service:start`
5. Verify health:
   - `http://127.0.0.1:8787/health`
   - Or another configured `PORT`

## Message Flow

1. Feishu long-connection client receives `im.message.receive_v1`
2. Inbound payload is normalized into:
   - `chatId`
   - `messageId`
   - `senderOpenId`
   - `text`
3. Allowlist check runs before task execution
4. Runtime stores a queued task
5. Runtime executes one task at a time
6. Codex returns a final assistant message plus raw logs
7. Bridge replies with the final assistant message on success, or a concise status-oriented failure summary

## Conversation Flow

The upgraded operating model is session-first:

1. Each Feishu `chatId` maps to a stable local session
2. Inbound and outbound messages append to the same session record
3. Task execution remains linked to that session rather than replacing it
4. Operators can inspect the session as JSON or Markdown from the PC
5. PC-originated follow-up work should continue the same session and optionally reply back to the same Feishu chat

Local session mirrors are intended to live at:

- `%LOCALAPPDATA%\feishu-codex-bridge\data\conversations.json`
- `%LOCALAPPDATA%\feishu-codex-bridge\conversations\`

## Windows Pitfalls

- Do not assume `codex` resolves the same way on Windows as on Unix.
- `codex.cmd` may need wrapping.
- The safest repo-specific behavior is the existing runner logic:
  - prefer absolute `codex.cmd` or `codex.exe`
  - prefer `node .../@openai/codex/bin/codex.js` when available
  - otherwise wrap through PowerShell
- Keep stdin ignored. This repo intentionally uses `['ignore', 'pipe', 'pipe']` so the child does not wait for extra input.
- Absolute paths matter. Relative workspace roots are rejected by config validation.
- Keep runtime artifacts out of the repo working tree. Service mode stores them under `%LOCALAPPDATA%\feishu-codex-bridge` by default.

## Feishu Pitfalls

- This bridge is designed for long connection mode, not public webhook callbacks.
- Only `message_type: text` is accepted by the normalizer.
- Feishu text content arrives as JSON in `message.content`; it must be parsed instead of treated as raw text.
- Reply support is transport-dependent; if `sendMessage` is missing, replies will fail by design.

## Codex Pitfalls

- `/ask` should remain read-only even if the global configured sandbox is more permissive.
- `/run` is the only path that should use the configured writable sandbox mode.
- Prefer `--output-last-message` so Feishu sees the final natural answer, not the execution transcript.
- For workspace roots that are not trusted git directories, the runner must pass `--skip-git-repo-check` or Codex can fail before the prompt runs.
- Noise filtering still matters because stderr may contain banners, queue text, and token summaries.
- Timeout and non-zero exits should be summarized, not dumped raw into chat.

## Upgrade And Restart Pitfalls

- A rebuilt `dist` directory does not automatically upgrade the already-running background bridge.
- Feishu-triggered tasks execute inside the long-running Node service, so they continue to use whatever code was loaded when that process started.
- Verified failure mode on 2026-05-09:
  - `dist\codex-runner.js` already contained `--skip-git-repo-check`
  - local PC-side validation after a later restart passed
  - but Feishu tasks still failed with `Not inside a trusted directory and --skip-git-repo-check was not specified.`
  - root cause: the bridge process had been started before the rebuild, so Feishu traffic was still hitting the old in-memory code
- Operational rule:
  - after changing runtime code, run `npm run build`
  - then force a bridge restart with `npm run service:stop` and `npm run service:start`
  - then verify with `npm run service:status`, `/health`, and one real task-path smoke test
- Do not treat a successful local CLI test alone as proof that the Feishu-facing service is upgraded. Always verify against the live background bridge process.

## Service Operations

- Install background service: `npm run service:install`
- Start now: `npm run service:start`
- Stop: `npm run service:stop`
- Check status: `npm run service:status`
- Tail logs: `npm run service:logs`
- Remove scheduled task: `powershell -ExecutionPolicy Bypass -File scripts/uninstall-bridge-service.ps1`

## Session Operations

Feishu-side session inspection commands in the design:

- `/session`
  - quick view of the current chat's local session id and latest activity
- `/sessions`
  - recent sessions for the user
- `/history [count]`
  - recent turns for the current chat

PC-side continuation workflow in the design:

- list sessions locally
- show one session before resuming it
- continue the same session with a local `/ask` or `/run`
- optionally send the reply back through the same Feishu transport

The implementation plan names script-style entry points `sessions:list`, `sessions:show`, `sessions:ask`, and `sessions:run`. Keep those names unless implementation deliberately renames them.

## Verified Fixes And Stable Behaviors

- Config validation rejects missing secrets and non-absolute workspace roots.
- Optional runtime settings have safe defaults.
- Empty `CODEX_MODEL` is treated as unset.
- Runtime queues tasks sequentially rather than running them in parallel.
- Successful chat replies no longer include queue acknowledgements or `Request received. Starting task.` style boilerplate.
- `start()` in the Feishu service is idempotent.
- `/status` resolves by sender when no task id is supplied.

## Suggested Verification Commands

- `npm test -- --run`
- `npm run build`
- `npm run service:status`
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/health | Select-Object -ExpandProperty Content`

## Canonical Archive Location

- `F:\obsidian\wiki\raw\AI-projects\feishu-codex-bridge`

Keep bridge operational history and handoff notes there instead of scattering duplicates.

## Obsidian Sync Rule

- Obsidian sync is best-effort only.
- If `F:` is missing, locked, or offline, the bridge should keep running against its local `%LOCALAPPDATA%\feishu-codex-bridge` state.
- Do not make archive writes a prerequisite for task execution, session persistence, or Feishu replies.
