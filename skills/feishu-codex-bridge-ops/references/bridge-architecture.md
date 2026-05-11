# Bridge Architecture

## Scope

This skill targets the Feishu Codex bridge in:

- `C:\Users\yckj0094\Documents\Codex\2026-05-07\pc-codex`

## Verified Runtime Shape

- Runtime stack: Node.js + TypeScript
- Feishu transport: long connection mode via `@larksuiteoapi/node-sdk`
- Codex execution: bridge-owned native Codex sessions keyed by Feishu `chatId`
- Final reply extraction: final-answer-only relay from the active native session worker
- State storage: JSON task log under `%LOCALAPPDATA%\feishu-codex-bridge\data\tasks.json` by default
- Conversation/session storage target:
  - `%LOCALAPPDATA%\feishu-codex-bridge\data\conversations.json`
  - `%LOCALAPPDATA%\feishu-codex-bridge\conversations\`
- Native-session binding target:
  - `%LOCALAPPDATA%\feishu-codex-bridge\data\native-sessions.json`
- Health surface: local HTTP endpoint on `http://127.0.0.1:<PORT>/health`

## Session-Flow Upgrade

The bridge is being upgraded from a task-centric relay into a session-centric conversation system:

- Stable session key: Feishu `chatId`
- Bridge session identity: `sessionId`
- Native worker identity: Codex-native `codexSessionId`
- Message model: append-only conversation records with direction, source, text, timestamp, and optional task linkage
- Operator-facing mirror: Markdown transcripts readable without parsing JSON
- Idle lifecycle: 24-hour expiry measured from the last successful session use

When documenting or operating the upgraded bridge, describe the local source of truth as "session flow with linked tasks", not "tasks only".

## Component Map

- `src/index.ts`
  - Loads `.env.local` then `.env`
  - Builds the Lark transport
  - Resolves service runtime paths
  - Creates task store and bridge runtime
  - Starts the health server on loopback
- `src/config.ts`
  - Validates required Feishu secrets and workspace root
  - Enforces absolute `CODEX_WORKSPACE_ROOT`
  - Resolves runtime directories for data, logs, and PID files
  - Defaults `CODEX_APPROVAL_POLICY=never`
  - Defaults `CODEX_SANDBOX_MODE=workspace-write`
  - Defaults `CODEX_TIMEOUT_MS=900000`
  - Defaults `PORT=8787`
- `src/feishu.ts`
  - Normalizes inbound text messages
  - Filters non-text payloads
  - Makes `start()` idempotent
  - Delegates outbound replies to the transport
- `src/bridge.ts`
  - Rejects unauthorized senders before execution
  - Avoids visible acknowledgement noise for authorized requests
  - Keeps task execution asynchronous
- `src/runtime.ts`
  - Parses `/ask`, `/run`, `/status`, `/help`
  - Resolves the bridge-owned native session binding for each `chatId`
  - Queues one task at a time
  - Persists task state transitions
  - Sends only the natural completion message on success
- `src/native-session-store.ts`
  - Persists chat-to-native-session bindings, expiry, and last-used metadata
- `src/native-session-runner.ts`
  - Starts or resumes Codex-native sessions and extracts the final answer for Feishu
- `src/conversation-store.ts`
  - Persists sessions keyed by Feishu chat
  - Stores append-only message history plus task links
- `src/conversation-export.ts`
  - Writes human-readable Markdown transcripts for local inspection and handoff
- `src/session-cli.ts`
  - Supports the PC-side session continuation workflow described in the design
- `src/codex-runner.ts`
  - Remains the low-level Codex process helper for Windows-safe command resolution
  - Preserves `--skip-git-repo-check` where needed for non-trusted workspace roots
  - Must not regress final-answer extraction behavior when reused by native session workers
- `src/formatter.ts`
  - Strips noisy Codex banner and queue lines
  - Prefers the final assistant message when available
  - Truncates Feishu-facing replies
- `scripts/*.ps1`
  - Manage install, start, stop, status, logs, and uninstall for the user-scoped Windows service workflow

## Command Contract

- Plain text -> treated as `/ask`
- `/ask <prompt>` -> Codex read-only execution
- `/run <prompt>` -> writable execution inside `CODEX_WORKSPACE_ROOT`
- `/status [task-id]` -> last task or specific task status
- `/help` -> usage text

## Session Command Contract

The conversation-flow design adds these Feishu-safe session commands:

- `/session`
  - show current session id, last update time, and last task
- `/sessions`
  - show recent sessions for the current user
- `/history [count]`
  - return recent conversation turns in the current chat

For PC-side continuation, the implementation plan defines a local session CLI and package-script style entry points such as `sessions:list`, `sessions:show`, `sessions:ask`, and `sessions:run`.

## Native Session Visibility Goal

The native-worker design intentionally tries to share actual Codex-native session storage so local Codex clients can discover the same conversations:

- Codex CLI should be able to resume the bridge-created native session when given the stored `codexSessionId`.
- Codex desktop and VS Code may show the same session if they read the same native storage on the same machine.

That cross-client visibility is an operational goal, not a design-time guarantee. Document it as "verify on this machine" unless a specific client/version combination has been proven.

## Security Model

- Secrets stay in local `.env.local` or `.env`
- Sender allowlist is enforced by `ALLOWED_OPEN_IDS`
- `/ask` is forced to sandbox `read-only`
- `/run` inherits configured sandbox mode, default `workspace-write`
- Workspace root must be an absolute path
- Final Feishu replies remain final-answer-only even though the underlying native session may contain additional internal execution output

## Tested Behaviors Worth Preserving

- Windows prefers `codex.cmd`, but when the npm-installed package layout is present the runner uses `process.execPath` plus `@openai/codex/bin/codex.js`
- Successful replies prefer the final assistant message rather than noisy execution transcripts
- One native-session binding is reused per Feishu `chatId` until the 24-hour idle timeout expires
- Timeout kills the spawned process and reports a timed-out result
- Unsupported Feishu payloads are filtered instead of producing noisy failures
- Health checks bind to `127.0.0.1` only
- Obsidian archive sync must remain best-effort and non-fatal if `F:` is unavailable
