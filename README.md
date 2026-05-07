# Feishu Codex Bridge

Control Codex CLI from Feishu messages on a Windows PC and receive replies back in Feishu.

## Planned MVP

- Receive Feishu bot messages over long connection mode
- Parse `/ask`, `/run`, and `/status` commands
- Execute Codex CLI jobs locally with guardrails
- Reply with task status and summarized results
- Persist lightweight task history locally

## Local development

Project setup and implementation are tracked under `docs/superpowers/`.

1. Copy `.env.example` values into `.env.local`.
2. Fill `ALLOWED_OPEN_IDS` with the Feishu `open_id` values that are allowed to control the bridge.
3. Start the bridge with `npm run dev`.
4. Check the local health endpoint at `http://127.0.0.1:8787/health`.

## Commands

- Plain text: treated as `/ask`
- `/ask <prompt>`: read-only Codex task
- `/run <prompt>`: writable Codex task inside `CODEX_WORKSPACE_ROOT`
- `/status [task-id]`: fetch latest task state
- `/help`: print command help
