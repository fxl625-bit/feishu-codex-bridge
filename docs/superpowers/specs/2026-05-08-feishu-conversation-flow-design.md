# Feishu Conversation Flow Upgrade Design

## Goal

Upgrade the bridge from a one-off task relay into a local-visible, resumable conversation system so Feishu chats can be inspected on the PC, continued from the PC, and archived consistently for later AI handoff.

## User Problem

The current bridge is good at remote execution, but it behaves like a task queue rather than a shared conversation:

- Feishu messages are not visible as a first-class local conversation transcript.
- The PC operator can inspect task history, but not easily continue the same Feishu chat with context.
- There is no stable session model tying together chat messages, Codex runs, summaries, and follow-up work.

## Target User Experience

### On phone in Feishu

- Plain text and `/ask` still work as before.
- `/run` still works as before.
- `/status` still reports task state.
- New lightweight session commands make the active conversation inspectable:
  - `/sessions`
  - `/history [count]`
  - `/session`

### On PC

- Every Feishu chat gets a stable local session record.
- The latest session can be opened from local files and read as a clean transcript.
- The PC operator can continue an existing Feishu session locally and send the result back to the same Feishu chat.
- The session transcript remains backed up into the canonical Obsidian project archive.

## Recommended Approach

Use a chat-centric session model keyed by Feishu `chatId`, with append-only message records and task links.

This is better than trying to mirror into the live Codex desktop thread directly because:

- It is deterministic and toolable.
- It survives process restarts.
- It supports both phone-originated and PC-originated follow-up tasks.
- It can be exported to Markdown and archived without depending on Codex UI internals.

## Core Design

### 1. Conversation store

Add a new `conversation-store` module that persists:

- `sessionId`
- `chatId`
- `participants`
- `createdAt`
- `updatedAt`
- `lastTaskId`
- `messages[]`

Each message record should capture:

- direction: `inbound` | `outbound` | `local`
- source: `feishu` | `codex` | `pc`
- text
- timestamp
- related `taskId` when applicable
- task status snapshot when applicable

### 2. Task linkage

Extend task records so every task belongs to a session:

- `sessionId`
- `originMessageId`
- optional `replyMessageId`

This keeps task history queryable both by task and by conversation.

### 3. Local mirror format

Maintain two local representations:

- canonical machine-readable JSON store under `%LOCALAPPDATA%\feishu-codex-bridge\data\conversations.json`
- human-readable Markdown transcript files under `%LOCALAPPDATA%\feishu-codex-bridge\conversations\`

The Markdown file should be stable enough that the operator or another AI can open it later and understand the conversation without parsing JSON.

### 4. Conversation commands

Add new command surfaces:

- `/session`
  - show current session id, last update time, and last task
- `/sessions`
  - show the latest sessions for the current user
- `/history [count]`
  - return the most recent conversation turns in the current chat

These commands should be Feishu-safe and concise.

### 5. PC-side continuation workflow

Add a local CLI workflow that can continue a session from the PC:

- list sessions
- show one session
- run an `/ask` or `/run` task against an existing session
- optionally send the response back into the same Feishu chat

This should reuse the same runner, formatter, and Feishu transport rather than inventing a separate execution path.

### 6. Obsidian sync

Keep the existing canonical archive root:

- `<archive-root>`

Add a session-oriented sub-area for mirrored transcripts and operational notes. The runtime should not depend on Obsidian being available, so this sync must be best-effort and non-fatal.

## Components

- `src/conversation-store.ts`
  - persistent session store
- `src/conversation-export.ts`
  - Markdown mirror generation
- `src/session-cli.ts`
  - local PC continuation commands
- `src/commands.ts`
  - new session commands
- `src/runtime.ts`
  - log inbound/outbound messages to sessions
  - handle session lookup and new commands
- `src/task-store.ts`
  - add session linkage
- `src/config.ts`
  - resolve conversation runtime paths and optional archive sync path
- `src/index.ts`
  - wire conversation store and session CLI entry points

## Safety Model

- Existing sender allowlist remains mandatory.
- Existing workspace root guardrails remain mandatory.
- Session transcripts are local-first and contain only the data already flowing through the bridge.
- Archive sync must not leak secrets from `.env.local`.
- Obsidian writes must never break bridge execution if `F:` is unavailable.

## Verification Strategy

- Unit tests for session store CRUD and ordering
- Unit tests for conversation transcript export
- Command parsing tests for `/session`, `/sessions`, `/history`
- Runtime tests that inbound and outbound messages are mirrored into the session store
- E2E test that a task completion updates both task store and conversation transcript
- CLI tests for listing and continuing sessions
- Manual smoke check:
  - send a Feishu message
  - confirm new session transcript appears locally
  - continue the same session from the PC
  - confirm reply returns to Feishu and transcript is updated

## Recommended Development Split

1. Conversation persistence and transcript export
2. Session commands plus PC-side continuation workflow
3. Docs, Skill updates, and Obsidian archive sync rules
