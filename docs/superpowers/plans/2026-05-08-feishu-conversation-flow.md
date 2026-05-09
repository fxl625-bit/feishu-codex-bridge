# Feishu Conversation Flow Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the bridge so Feishu chats become local-visible, resumable sessions that can be continued from the PC and synchronized into the canonical archive.

**Architecture:** Add a dedicated conversation store and transcript exporter, link tasks to stable session ids, extend slash commands for session inspection, and add a PC-side session continuation CLI that reuses the existing bridge runtime and Feishu transport. Keep runtime persistence local-first under `%LOCALAPPDATA%` and make Obsidian sync best-effort.

**Tech Stack:** Node.js 24, TypeScript, Vitest, PowerShell service scripts, local JSON persistence, Markdown transcript export, Feishu Node SDK

---

## File Structure

- Create: `src/conversation-store.ts`
- Create: `src/conversation-export.ts`
- Create: `src/session-cli.ts`
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Modify: `src/commands.ts`
- Modify: `src/runtime.ts`
- Modify: `src/task-store.ts`
- Modify: `src/formatter.ts`
- Create: `tests/conversation-store.test.ts`
- Create: `tests/conversation-export.test.ts`
- Modify: `tests/commands.test.ts`
- Modify: `tests/runtime.test.ts`
- Modify: `tests/e2e-bridge.test.ts`
- Create: `tests/session-cli.test.ts`
- Modify: `README.md`
- Modify: `docs/windows-service.md`
- Modify: `skills/feishu-codex-bridge-ops/**`

### Task 1: Add Conversation Persistence And Runtime Paths

**Files:**
- Create: `src/conversation-store.ts`
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/task-store.ts`
- Test: `tests/conversation-store.test.ts`
- Test: `tests/config.test.ts`
- Test: `tests/task-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove:

- a conversation session is created on first inbound message for a `chatId`
- later messages append to the same session
- sessions can be listed by `updatedAt`
- runtime path resolution includes:
  - `conversationsFile`
  - `conversationsDir`
  - optional `archiveSyncDir`
- task records persist `sessionId`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run tests/conversation-store.test.ts tests/config.test.ts tests/task-store.test.ts`
Expected: FAIL because conversation persistence and new path fields do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement:

- `ConversationSessionRecord`
- `ConversationMessageRecord`
- `createConversationStore()`
- config/runtime path expansion for conversation artifacts
- `TaskRecord.sessionId`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/conversation-store.test.ts tests/config.test.ts tests/task-store.test.ts`
Expected: PASS with the new persistence model green.

- [ ] **Step 5: Commit**

```bash
git add src/conversation-store.ts src/types.ts src/config.ts src/task-store.ts tests/conversation-store.test.ts tests/config.test.ts tests/task-store.test.ts
git commit -m "feat: add conversation persistence"
```

### Task 2: Mirror Feishu Sessions Into Human-Readable Transcripts

**Files:**
- Create: `src/conversation-export.ts`
- Modify: `src/runtime.ts`
- Modify: `src/index.ts`
- Test: `tests/conversation-export.test.ts`
- Test: `tests/runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove:

- a session can be rendered into Markdown with ordered turns
- inbound Feishu text is mirrored as a transcript entry
- outbound completion text is mirrored as a transcript entry
- transcript export updates after task completion

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run tests/conversation-export.test.ts tests/runtime.test.ts`
Expected: FAIL because transcript export and runtime mirroring do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement:

- Markdown export helper
- transcript file writes under `%LOCALAPPDATA%\feishu-codex-bridge\conversations\`
- runtime hooks that append:
  - inbound user message
  - outbound bot reply
  - task-linked completion metadata

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/conversation-export.test.ts tests/runtime.test.ts`
Expected: PASS with mirrored transcripts generated correctly.

- [ ] **Step 5: Commit**

```bash
git add src/conversation-export.ts src/runtime.ts src/index.ts tests/conversation-export.test.ts tests/runtime.test.ts
git commit -m "feat: mirror feishu conversations locally"
```

### Task 3: Add Session Commands For Feishu Chat

**Files:**
- Modify: `src/commands.ts`
- Modify: `src/types.ts`
- Modify: `src/runtime.ts`
- Modify: `src/formatter.ts`
- Test: `tests/commands.test.ts`
- Test: `tests/runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests for:

- `/session`
- `/sessions`
- `/history`
- concise formatting for session summaries and history replies

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run tests/commands.test.ts tests/runtime.test.ts`
Expected: FAIL because the new command kinds and handlers do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement:

- new command parsing branches
- runtime handlers that query the conversation store
- concise formatter helpers for session metadata and history

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/commands.test.ts tests/runtime.test.ts`
Expected: PASS with new session commands working end-to-end.

- [ ] **Step 5: Commit**

```bash
git add src/commands.ts src/types.ts src/runtime.ts src/formatter.ts tests/commands.test.ts tests/runtime.test.ts
git commit -m "feat: add feishu session commands"
```

### Task 4: Add PC-Side Session Continuation CLI

**Files:**
- Create: `src/session-cli.ts`
- Modify: `package.json`
- Modify: `src/index.ts`
- Test: `tests/session-cli.test.ts`
- Test: `tests/e2e-bridge.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove:

- sessions can be listed locally
- a local continuation command can target an existing `sessionId`
- the continuation task reuses the same `chatId`
- the resulting reply is sent through Feishu transport and mirrored into the transcript

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run tests/session-cli.test.ts tests/e2e-bridge.test.ts`
Expected: FAIL because no session CLI exists yet.

- [ ] **Step 3: Write minimal implementation**

Implement:

- a local session CLI entry point
- package scripts such as:
  - `sessions:list`
  - `sessions:show`
  - `sessions:ask`
  - `sessions:run`
- runtime reuse so local follow-up work behaves like normal bridge tasks

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/session-cli.test.ts tests/e2e-bridge.test.ts`
Expected: PASS with PC-side continuation wired correctly.

- [ ] **Step 5: Commit**

```bash
git add src/session-cli.ts src/index.ts package.json tests/session-cli.test.ts tests/e2e-bridge.test.ts
git commit -m "feat: add pc-side session continuation"
```

### Task 5: Sync Docs, Skill, And Archive Rules

**Files:**
- Modify: `README.md`
- Modify: `docs/windows-service.md`
- Modify: `skills/feishu-codex-bridge-ops/SKILL.md`
- Modify: `skills/feishu-codex-bridge-ops/references/bridge-architecture.md`
- Modify: `skills/feishu-codex-bridge-ops/references/bridge-operations.md`
- Update: `F:\obsidian\wiki\raw\AI-projects\feishu-codex-bridge\ARCHIVE.md`
- Update: `F:\obsidian\wiki\skills\packages\feishu-codex-bridge-ops\**`

- [ ] **Step 1: Write the failing verification checks**

Define verification expectations:

- docs mention local-visible mirrored conversations
- docs mention PC continuation workflow
- Skill references the new session-flow architecture
- archive notes explain where transcripts live and how they sync

- [ ] **Step 2: Run verification to show docs are outdated**

Run:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File skills/feishu-codex-bridge-ops/scripts/verify-bridge-skill-target.ps1
python F:\obsidian\wiki\skills\tools\validate_scan_ready.py
```

Expected: target verification passes, but the current docs do not yet describe the upgraded session flow.

- [ ] **Step 3: Write minimal documentation updates**

Update:

- operator docs
- Skill docs
- canonical archive notes
- package references in the Obsidian vault

- [ ] **Step 4: Run verification to verify docs and skill structure pass**

Run:

```bash
python F:\obsidian\wiki\skills\tools\validate_scan_ready.py
```

Expected: PASS with updated scan-ready package structure intact.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/windows-service.md skills/feishu-codex-bridge-ops
git commit -m "docs: describe session flow workflow"
```

### Task 6: Full Verification And Live Smoke

**Files:**
- Modify if needed: any files touched during integration fixes
- Verify: runtime service scripts and local transcript outputs

- [ ] **Step 1: Run the full automated verification**

Run: `npm test -- --run`
Expected: PASS with all existing and new tests green.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: PASS with `dist/` updated successfully.

- [ ] **Step 3: Restart the bridge under the service wrapper**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-bridge.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-bridge.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/status-bridge.ps1
```

Expected: process running, health OK, startup fallback or scheduled task visible.

- [ ] **Step 4: Run the live conversation smoke check**

Verify:

- a Feishu inbound message creates or updates a local session transcript
- the mirrored transcript file appears under `%LOCALAPPDATA%\feishu-codex-bridge\conversations\`
- a PC-side session continuation command sends the reply back into the same Feishu chat

- [ ] **Step 5: Commit final integration adjustments**

```bash
git add src tests docs scripts skills
git commit -m "feat: add resumable feishu conversation flow"
```
