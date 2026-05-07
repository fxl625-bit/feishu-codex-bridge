# Feishu Codex Bridge Design

## Goal

Build a self-hosted bridge on the user's Windows PC so a Feishu self-built app can receive messages from the user's phone, invoke Codex CLI locally, and return structured replies back to Feishu without exposing a public webhook.

## User Experience

The primary interaction is a private chat with the Feishu bot:

- `/ask <prompt>`: run a read-only analysis task and reply with a concise answer plus task id.
- `/run <prompt>`: run a task that may modify files inside the configured workspace root.
- `/status [task-id]`: show the latest status or details for a specific task.
- Plain text without a command is treated as `/ask`.

The bot should immediately acknowledge receipt, continue processing asynchronously, and then send a completion or failure message when the task finishes.

## Recommended Architecture

### Runtime

- Node.js + TypeScript service running on the Windows PC
- Feishu Node SDK long connection mode for inbound event delivery
- Codex CLI `exec` for non-interactive execution
- Local JSON persistence for task history and lightweight state

### Components

1. `config`
   - Loads environment variables
   - Validates required secrets and workspace constraints
   - Exposes runtime policy such as allowed users, workspace root, model, timeout, and sandbox mode

2. `feishu`
   - Starts the long-connection client
   - Normalizes incoming messages
   - Sends replies back to Feishu
   - Filters unsupported message types

3. `commands`
   - Parses message content into a typed command model
   - Supports `/ask`, `/run`, `/status`, `/help`
   - Provides clear usage errors

4. `authz`
   - Enforces sender allowlist by open id
   - Rejects unauthorized users before execution

5. `tasks`
   - Creates task ids
   - Tracks queued, running, completed, failed states
   - Stores timestamps, command mode, sender, prompt summary, and result metadata

6. `codex runner`
   - Launches `codex exec`
   - Applies execution defaults based on command mode
   - Captures stdout, stderr, exit code, and timeout
   - Prevents execution outside the configured workspace root

7. `result formatter`
   - Produces short Feishu-safe summaries
   - Truncates long outputs
   - Includes links or file path summaries when available

## Security Model

- Secrets live only in local `.env.local` and never in git.
- Only configured `ALLOWED_OPEN_IDS` may invoke commands.
- `/ask` runs with stricter policy than `/run`.
- All Codex jobs are pinned to `CODEX_WORKSPACE_ROOT`.
- Initial MVP processes one task at a time to reduce concurrency risk.
- Output sent back to Feishu is summarized and truncated to avoid flooding chat.

## Operational Model

- Use Feishu long connection mode to avoid public callback exposure.
- Start service via `npm run dev` for local testing and `npm run start` for production.
- Provide a health endpoint so the process can be monitored locally.
- Persist task history under a project-local `data/` directory.

## Error Handling

- Invalid command: return help text immediately.
- Unauthorized user: return a permission error without invoking Codex.
- Codex non-zero exit: mark task failed and include stderr summary.
- Timeout: kill the process and report timeout status.
- Feishu send failure: log locally and keep task record for manual inspection.

## Testing Strategy

- Unit tests for config validation, command parsing, authorization, output formatting, and task store behavior
- Integration tests for Codex process orchestration using a fake executor
- Integration tests for Feishu event handling using mocked SDK-facing adapters

## Scope Boundaries For MVP

Included:

- Long connection inbound messaging
- Text command parsing
- Sequential task execution
- Local task persistence
- Reply messages for accepted, completed, failed states

Not included in MVP:

- Multi-user role management beyond a simple allowlist
- Rich interactive cards
- Streaming partial output to Feishu
- Parallel Codex jobs
- Remote desktop control

## Design Decision

Use Feishu long connection mode plus Codex CLI first. This is the fastest path to a stable private bot on a single PC. If later requirements expand to richer workflow automation, the Codex execution layer can be replaced by a Codex SDK or Responses API worker without changing the Feishu-facing command contract.
