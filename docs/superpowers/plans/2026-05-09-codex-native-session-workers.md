# Codex Native Session Workers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-message cold-start `codex exec` runs with per-Feishu-chat native Codex session workers that stay warm for 24 hours of idle time, return only the final answer, and maximize visibility in Codex CLI / desktop / VS Code session surfaces.

**Architecture:** Bind each Feishu `chatId` to a real Codex native session id stored in bridge-owned runtime state on `F:\CODEX`. Introduce a session worker layer that creates or resumes native Codex sessions instead of spawning a brand-new one-shot task every time. Keep the bridge’s allowlist, `/ask` read-only guarantee, `/run` workspace scoping, session transcript persistence, and best-effort Obsidian sync unchanged.

**Tech Stack:** TypeScript, Node.js, Codex CLI native session commands (`codex`, `resume`, `exec resume` if appropriate), Vitest, Windows PowerShell service scripts, JSON-backed runtime state.

---

## File Map

- Create: `src/native-session-store.ts`
  - Persists chat-to-native-session bindings, worker lifecycle metadata, idle expiry, and visibility hints.
- Create: `src/native-session-runner.ts`
  - Encapsulates native Codex session creation, resume, stdout/stderr handling, and final-answer extraction for long-lived workers.
- Create: `tests/native-session-store.test.ts`
  - Verifies registry persistence, expiry updates, and binding lookup behavior.
- Create: `tests/native-session-runner.test.ts`
  - Verifies native session CLI invocation behavior, resume flows, and final-message extraction.
- Modify: `src/codex-runner.ts`
  - Either narrow it to one-shot execution only or extract shared low-level process helpers that native-session runner can reuse.
- Modify: `src/runtime.ts`
  - Route Feishu task execution through native session workers for `ask` and `run` paths while preserving transcripts, final-answer-only replies, and status semantics.
- Modify: `src/index.ts`
  - Wire native session registry/runtime dependencies into the application.
- Modify: `src/config.ts`
  - Add config for worker idle timeout (24 hours), native session registry path, and any shared session visibility options we need.
- Modify: `src/types.ts`
  - Add runtime path/type definitions for native session metadata.
- Modify: `tests/runtime.test.ts`
  - Cover routing through the native worker layer and final-answer-only behavior.
- Modify: `tests/config.test.ts`
  - Cover new runtime path and worker-timeout config behavior.
- Modify: `tests/e2e-bridge.test.ts`
  - Cover end-to-end session reuse behavior at the bridge/runtime boundary.
- Modify: `README.md`
  - Document native session workers, 24-hour reuse, and the expectation that native sessions should be visible to Codex-native clients when shared storage is used.
- Modify: `docs/windows-service.md`
  - Document operational checks, restart expectations, and new worker-specific troubleshooting.
- Modify: `skills/feishu-codex-bridge-ops/references/bridge-architecture.md`
  - Document the new native-session worker layer.
- Modify: `skills/feishu-codex-bridge-ops/references/bridge-operations.md`
  - Document verification steps and pitfalls for shared native sessions.
- Modify: `F:\obsidian\wiki\raw\AI-projects\feishu-codex-bridge\ARCHIVE.md`
  - Append the verified operational model and any client-visibility caveats after implementation.

## Task 1: Add Native Session Registry

**Files:**
- Create: `src/native-session-store.ts`
- Create: `tests/native-session-store.test.ts`
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write the failing registry persistence tests**

```ts
import { describe, expect, it } from 'vitest';
import { createNativeSessionStore } from '../src/native-session-store.js';

describe('native session store', () => {
  it('creates and reloads a chat binding', async () => {
    const store = createNativeSessionStore({
      dataFile: 'TEMP/native-sessions.json',
      idleTimeoutMs: 24 * 60 * 60 * 1000,
    });

    await store.upsert({
      chatId: 'oc_1',
      codexSessionId: 'sess_1',
      workerKind: 'ask',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
    });

    const binding = await store.getByChatId('oc_1');
    expect(binding?.codexSessionId).toBe('sess_1');
    expect(binding?.expiresAt).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the registry tests to verify they fail**

Run: `npm test -- --run tests/native-session-store.test.ts tests/config.test.ts`
Expected: FAIL because `native-session-store.ts` and the new config/runtime path definitions do not exist yet.

- [ ] **Step 3: Implement minimal native session registry and config plumbing**

```ts
export interface NativeSessionBinding {
  chatId: string;
  codexSessionId: string;
  workerKind: 'ask' | 'run';
  workspaceRoot: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}
```

Implement the store with:
- JSON file persistence under bridge runtime data on `F:\CODEX`
- `getByChatId(chatId)`
- `upsert(bindingInput)`
- `touch(chatId)`
- `delete(chatId)`
- `listExpired(now)`

Add config/runtime definitions for:
- native session registry file path
- worker idle timeout defaulting to `24 * 60 * 60 * 1000`

- [ ] **Step 4: Re-run the registry and config tests**

Run: `npm test -- --run tests/native-session-store.test.ts tests/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the registry task**

```bash
git add src/native-session-store.ts src/types.ts src/config.ts tests/native-session-store.test.ts tests/config.test.ts
git commit -m "feat: add native session registry"
```

## Task 2: Build Native Codex Session Runner

**Files:**
- Create: `src/native-session-runner.ts`
- Create: `tests/native-session-runner.test.ts`
- Modify: `src/codex-runner.ts`

- [ ] **Step 1: Write the failing native-runner tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createNativeSessionRunner } from '../src/native-session-runner.js';

describe('native session runner', () => {
  it('starts a native codex session for a first prompt', async () => {
    const spawn = vi.fn();
    const runner = createNativeSessionRunner({ spawn });

    await runner.run({
      prompt: 'hello',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
      mode: 'start',
    });

    expect(spawn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the native-runner tests to verify they fail**

Run: `npm test -- --run tests/native-session-runner.test.ts`
Expected: FAIL because `native-session-runner.ts` does not exist yet.

- [ ] **Step 3: Implement the native session runner with explicit start/resume modes**

```ts
export interface NativeSessionRunRequest {
  mode: 'start' | 'resume';
  prompt: string;
  workspaceRoot: string;
  codexSessionId?: string;
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy?: string;
  tempDir?: string;
}
```

Implementation requirements:
- start mode creates a real Codex interactive/native session, captures its session id, and returns the final answer
- resume mode continues an existing real Codex session id
- preserve `--skip-git-repo-check`
- preserve final-answer extraction
- keep temp files under `F:\CODEX\feishu-codex-bridge\run`
- do not emit queue/noise text back to bridge callers

- [ ] **Step 4: Re-run native-runner tests**

Run: `npm test -- --run tests/native-session-runner.test.ts tests/codex-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the native-runner task**

```bash
git add src/native-session-runner.ts src/codex-runner.ts tests/native-session-runner.test.ts tests/codex-runner.test.ts
git commit -m "feat: add native codex session runner"
```

## Task 3: Route Bridge Runtime Through Native Session Workers

**Files:**
- Modify: `src/runtime.ts`
- Modify: `src/index.ts`
- Modify: `tests/runtime.test.ts`
- Modify: `tests/e2e-bridge.test.ts`

- [ ] **Step 1: Write the failing runtime reuse tests**

```ts
it('reuses the same native codex session for repeated messages from one chat', async () => {
  const runner = {
    run: vi
      .fn()
      .mockResolvedValueOnce({ sessionId: 'sess_1', finalMessage: 'first' })
      .mockResolvedValueOnce({ sessionId: 'sess_1', finalMessage: 'second' }),
  };

  // send two asks from same chat, then assert second call used resume mode
});
```

- [ ] **Step 2: Run runtime/e2e tests to verify they fail**

Run: `npm test -- --run tests/runtime.test.ts tests/e2e-bridge.test.ts`
Expected: FAIL because runtime still uses one-shot execution only.

- [ ] **Step 3: Implement minimal runtime integration**

Behavior requirements:
- first message for a `chatId` creates a new native Codex session binding
- later messages within 24 hours reuse that same binding
- expired bindings trigger a fresh native session
- `/ask` and `/run` preserve their sandbox guarantees
- Feishu still receives only the final answer
- transcripts still append one inbound and one outbound logical turn
- queueing remains per chat or per worker to preserve turn ordering

- [ ] **Step 4: Re-run runtime/e2e tests**

Run: `npm test -- --run tests/runtime.test.ts tests/e2e-bridge.test.ts tests/session-cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the runtime integration task**

```bash
git add src/runtime.ts src/index.ts tests/runtime.test.ts tests/e2e-bridge.test.ts tests/session-cli.test.ts
git commit -m "feat: reuse native codex sessions per chat"
```

## Task 4: Add Expiry, Recovery, And Service-Safe Lifecycle Handling

**Files:**
- Modify: `src/native-session-store.ts`
- Modify: `src/native-session-runner.ts`
- Modify: `src/runtime.ts`
- Modify: `tests/native-session-store.test.ts`
- Modify: `tests/native-session-runner.test.ts`

- [ ] **Step 1: Write the failing expiry/recovery tests**

```ts
it('starts a fresh session when an existing binding is expired', async () => {
  // seed expired binding, expect next run to use start mode instead of resume
});

it('recreates a binding if native resume fails because the session no longer exists', async () => {
  // first resume fails, fallback start succeeds
});
```

- [ ] **Step 2: Run expiry/recovery tests to verify they fail**

Run: `npm test -- --run tests/native-session-store.test.ts tests/native-session-runner.test.ts`
Expected: FAIL because expiry and fallback behavior is not implemented yet.

- [ ] **Step 3: Implement minimal expiry and recovery behavior**

Rules:
- 24-hour idle timeout from `lastUsedAt`
- if resume fails due to missing/invalid session, delete binding and retry with start mode once
- do not break transcript or task status updates during fallback
- keep the worker registry authoritative from the bridge side even if Codex-native session files disappear

- [ ] **Step 4: Re-run expiry/recovery tests**

Run: `npm test -- --run tests/native-session-store.test.ts tests/native-session-runner.test.ts tests/runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the lifecycle task**

```bash
git add src/native-session-store.ts src/native-session-runner.ts src/runtime.ts tests/native-session-store.test.ts tests/native-session-runner.test.ts tests/runtime.test.ts
git commit -m "feat: add native session expiry and recovery"
```

## Task 5: Document Native Session Visibility And Operational Pitfalls

**Files:**
- Modify: `README.md`
- Modify: `docs/windows-service.md`
- Modify: `skills/feishu-codex-bridge-ops/references/bridge-architecture.md`
- Modify: `skills/feishu-codex-bridge-ops/references/bridge-operations.md`
- Modify: `F:\obsidian\wiki\raw\AI-projects\feishu-codex-bridge\ARCHIVE.md`

- [ ] **Step 1: Write the failing docs expectation checklist**

Create a short checklist in the task notes that must be reflected in docs:
- native sessions are keyed by Feishu `chatId`
- 24-hour idle expiry
- final-answer-only replies remain unchanged
- restart requirements after runtime changes
- visibility goal: shared Codex-native session storage so CLI/desktop/VS Code can discover the same sessions
- caveat: client visibility must be verified against actual local Codex-native behavior, not assumed

- [ ] **Step 2: Update docs with exact operational guidance**

Required content:
- how native session workers differ from old one-shot `codex exec`
- where bridge bindings live on `F:\CODEX`
- how to verify a session can be resumed with native Codex commands
- how to test whether desktop / VS Code surfaces show the session
- all previously verified Windows pitfalls

- [ ] **Step 3: Re-read docs for consistency**

Run:
- `Get-Content README.md`
- `Get-Content docs/windows-service.md`
- `Get-Content skills/feishu-codex-bridge-ops/references/bridge-operations.md`

Expected: all native-worker details align, no contradictions about one-shot execution versus native session reuse.

- [ ] **Step 4: Commit the docs task**

```bash
git add README.md docs/windows-service.md skills/feishu-codex-bridge-ops/references/bridge-architecture.md skills/feishu-codex-bridge-ops/references/bridge-operations.md
git commit -m "docs: add native session worker operations"
```

## Task 6: Final Integration Verification

**Files:**
- Verify working tree only; no new production files expected unless bugs are found during validation.

- [ ] **Step 1: Run full test suite**

Run: `npm test -- --run`
Expected: all tests pass

- [ ] **Step 2: Build production output**

Run: `npm run build`
Expected: successful TypeScript build

- [ ] **Step 3: Restart live bridge**

Run:

```powershell
npm run service:stop
npm run service:start
npm run service:status
```

Expected: bridge healthy and running from `F:\CODEX` runtime paths

- [ ] **Step 4: Run live smoke for native session reuse**

Run one prompt twice through the same bridge-visible chat/session path and verify:
- the second run uses resume behavior rather than a brand-new native session id
- final answer arrives without placeholder text
- task/transcript files update under `F:\CODEX`

- [ ] **Step 5: Verify Codex-native session discoverability**

Run:

```powershell
codex resume --help
Get-ChildItem %USERPROFILE%\.codex\sessions
Get-Content %USERPROFILE%\.codex\session_index.jsonl -Tail 20
```

Expected:
- bridge-created native sessions appear in Codex-native storage
- the session id used by the bridge can be correlated with local Codex session metadata

- [ ] **Step 6: Commit any final fixes**

```bash
git add <only-files-fixed-during-verification>
git commit -m "fix: polish native session worker integration"
```
