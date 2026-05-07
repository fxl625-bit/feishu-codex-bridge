# Feishu Codex Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local TypeScript service that receives Feishu bot messages, runs Codex CLI jobs inside a configured workspace, and replies with task status and results.

**Architecture:** The service is split into config, command parsing, task management, Codex execution, and Feishu transport layers. The MVP runs one task at a time, uses Feishu long connection mode instead of a public webhook, and persists task history locally in JSON.

**Tech Stack:** Node.js 24, TypeScript, Vitest, tsx, zod, @larksuiteoapi/node-sdk

---

## File Structure

- `package.json`: project metadata, scripts, runtime and test dependencies
- `tsconfig.json`: TypeScript compiler settings
- `vitest.config.ts`: test configuration
- `src/index.ts`: application entrypoint
- `src/config.ts`: environment parsing and validation
- `src/commands.ts`: command parsing and usage text
- `src/authz.ts`: allowlist checks
- `src/task-store.ts`: persistent task state
- `src/codex-runner.ts`: local Codex process orchestration
- `src/formatter.ts`: Feishu-safe reply formatting
- `src/bridge.ts`: service wiring and sequential queue
- `src/feishu.ts`: Feishu channel integration
- `src/types.ts`: shared types
- `src/utils/fs.ts`: data directory helpers
- `tests/*.test.ts`: unit and integration tests per module
- `data/.gitkeep`: local task storage directory placeholder
- `.env.local`: local secrets, not committed

### Task 1: Bootstrap TypeScript Service Skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `src/types.ts`
- Create: `data/.gitkeep`
- Test: `tests/smoke.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createAppMetadata } from '../src/index';

describe('createAppMetadata', () => {
  it('returns the application name for smoke verification', () => {
    expect(createAppMetadata().name).toBe('feishu-codex-bridge');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/smoke.test.ts`
Expected: FAIL because `src/index.ts` or `createAppMetadata` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function createAppMetadata() {
  return {
    name: 'feishu-codex-bridge',
    version: '0.1.0',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/smoke.test.ts`
Expected: PASS with 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/index.ts src/types.ts data/.gitkeep tests/smoke.test.ts
git commit -m "feat: bootstrap bridge service"
```

### Task 2: Add Config, Authorization, and Command Parsing

**Files:**
- Create: `src/config.ts`
- Create: `src/authz.ts`
- Create: `src/commands.ts`
- Create: `tests/config.test.ts`
- Create: `tests/authz.test.ts`
- Create: `tests/commands.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/commands';

describe('parseCommand', () => {
  it('treats plain text as ask mode', () => {
    expect(parseCommand('inspect the repo')).toMatchObject({
      kind: 'ask',
      prompt: 'inspect the repo',
    });
  });

  it('parses explicit run mode', () => {
    expect(parseCommand('/run update README')).toMatchObject({
      kind: 'run',
      prompt: 'update README',
    });
  });
});
```

```ts
import { describe, expect, it } from 'vitest';
import { isAuthorizedUser } from '../src/authz';

describe('isAuthorizedUser', () => {
  it('allows known open ids', () => {
    expect(isAuthorizedUser(['ou_1'], 'ou_1')).toBe(true);
  });

  it('rejects unknown open ids', () => {
    expect(isAuthorizedUser(['ou_1'], 'ou_2')).toBe(false);
  });
});
```

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('parses required environment values', () => {
    const config = loadConfig({
      FEISHU_APP_ID: 'app',
      FEISHU_APP_SECRET: 'secret',
      ALLOWED_OPEN_IDS: 'ou_1,ou_2',
      CODEX_WORKSPACE_ROOT: 'C:/workspace',
    });

    expect(config.allowedOpenIds).toEqual(['ou_1', 'ou_2']);
    expect(config.codexWorkspaceRoot).toBe('C:/workspace');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run tests/config.test.ts tests/authz.test.ts tests/commands.test.ts`
Expected: FAIL because the new modules do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function parseCommand(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith('/run ')) {
    return { kind: 'run', prompt: trimmed.slice(5).trim() };
  }
  if (trimmed.startsWith('/status')) {
    return { kind: 'status', prompt: trimmed.slice(7).trim() };
  }
  return { kind: 'ask', prompt: trimmed.replace(/^\/ask\s+/, '') };
}
```

```ts
export function isAuthorizedUser(allowedOpenIds: string[], senderOpenId: string) {
  return allowedOpenIds.includes(senderOpenId);
}
```

```ts
export function loadConfig(env: Record<string, string | undefined>) {
  return {
    feishuAppId: env.FEISHU_APP_ID ?? '',
    feishuAppSecret: env.FEISHU_APP_SECRET ?? '',
    allowedOpenIds: (env.ALLOWED_OPEN_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    codexWorkspaceRoot: env.CODEX_WORKSPACE_ROOT ?? '',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/config.test.ts tests/authz.test.ts tests/commands.test.ts`
Expected: PASS with all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/authz.ts src/commands.ts tests/config.test.ts tests/authz.test.ts tests/commands.test.ts
git commit -m "feat: add config auth and command parsing"
```

### Task 3: Implement Task Store, Formatter, and Codex Runner

**Files:**
- Create: `src/task-store.ts`
- Create: `src/formatter.ts`
- Create: `src/codex-runner.ts`
- Create: `src/utils/fs.ts`
- Create: `tests/task-store.test.ts`
- Create: `tests/formatter.test.ts`
- Create: `tests/codex-runner.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { createTaskStore } from '../src/task-store';

describe('task store', () => {
  it('creates and retrieves tasks', async () => {
    const store = createTaskStore({ dataFile: 'temp/tasks.json' });
    const task = await store.create({
      chatId: 'oc_1',
      senderOpenId: 'ou_1',
      kind: 'ask',
      prompt: 'inspect repo',
    });

    const loaded = await store.get(task.id);
    expect(loaded?.prompt).toBe('inspect repo');
    expect(loaded?.status).toBe('queued');
  });
});
```

```ts
import { describe, expect, it } from 'vitest';
import { formatCompletionMessage } from '../src/formatter';

describe('formatCompletionMessage', () => {
  it('includes task id and exit summary', () => {
    const text = formatCompletionMessage({
      id: 'task_1',
      status: 'completed',
      summary: 'Updated README',
    });

    expect(text).toContain('task_1');
    expect(text).toContain('Updated README');
  });
});
```

```ts
import { describe, expect, it, vi } from 'vitest';
import { createCodexRunner } from '../src/codex-runner';

describe('codex runner', () => {
  it('builds an ask-mode codex exec command', async () => {
    const spawn = vi.fn();
    const runner = createCodexRunner({ spawn });

    await runner.run({
      kind: 'ask',
      prompt: 'inspect repo',
      workspaceRoot: 'C:/workspace',
    });

    expect(spawn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run tests/task-store.test.ts tests/formatter.test.ts tests/codex-runner.test.ts`
Expected: FAIL because store, formatter, and runner modules do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function formatCompletionMessage(task: { id: string; status: string; summary: string }) {
  return `Task ${task.id} [${task.status}]\\n${task.summary}`;
}
```

```ts
export function createCodexRunner({ spawn }: { spawn: (...args: unknown[]) => unknown }) {
  return {
    async run(job: { kind: 'ask' | 'run'; prompt: string; workspaceRoot: string }) {
      spawn('codex', ['exec', job.prompt], { cwd: job.workspaceRoot });
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/task-store.test.ts tests/formatter.test.ts tests/codex-runner.test.ts`
Expected: PASS with all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/task-store.ts src/formatter.ts src/codex-runner.ts src/utils/fs.ts tests/task-store.test.ts tests/formatter.test.ts tests/codex-runner.test.ts
git commit -m "feat: add task persistence and codex runner"
```

### Task 4: Wire Bridge Service and Feishu Transport

**Files:**
- Create: `src/bridge.ts`
- Create: `src/feishu.ts`
- Create: `tests/bridge.test.ts`
- Create: `tests/feishu.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createBridge } from '../src/bridge';

describe('bridge', () => {
  it('rejects unauthorized users before execution', async () => {
    const sendReply = vi.fn();
    const runTask = vi.fn();
    const bridge = createBridge({
      allowedOpenIds: ['ou_ok'],
      sendReply,
      runTask,
    });

    await bridge.handleMessage({
      chatId: 'oc_1',
      messageId: 'om_1',
      senderOpenId: 'ou_no',
      text: '/ask inspect repo',
    });

    expect(runTask).not.toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalled();
  });
});
```

```ts
import { describe, expect, it, vi } from 'vitest';
import { createFeishuService } from '../src/feishu';

describe('feishu service', () => {
  it('registers a message handler', async () => {
    const connect = vi.fn();
    const onMessage = vi.fn();
    const service = createFeishuService({
      connect,
      onMessage,
    });

    await service.start();
    expect(connect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run tests/bridge.test.ts tests/feishu.test.ts`
Expected: FAIL because bridge and Feishu transport are not implemented yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function createBridge(deps: {
  allowedOpenIds: string[];
  sendReply: (...args: unknown[]) => Promise<unknown>;
  runTask: (...args: unknown[]) => Promise<unknown>;
}) {
  return {
    async handleMessage(message: {
      chatId: string;
      messageId: string;
      senderOpenId: string;
      text: string;
    }) {
      if (!deps.allowedOpenIds.includes(message.senderOpenId)) {
        await deps.sendReply(message.chatId, 'Unauthorized');
        return;
      }
      await deps.runTask(message);
    },
  };
}
```

```ts
export function createFeishuService(deps: {
  connect: () => Promise<void>;
  onMessage: (message: unknown) => Promise<void>;
}) {
  return {
    async start() {
      await deps.connect();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/bridge.test.ts tests/feishu.test.ts`
Expected: PASS with all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/bridge.ts src/feishu.ts src/index.ts tests/bridge.test.ts tests/feishu.test.ts
git commit -m "feat: wire bridge and feishu transport"
```

### Task 5: Integrate Secrets, End-to-End Flow, and Operational Docs

**Files:**
- Modify: `.env.example`
- Create: `.env.local`
- Create: `tests/e2e-bridge.test.ts`
- Modify: `README.md`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createRuntimeSummary } from '../src/index';

describe('createRuntimeSummary', () => {
  it('reports long connection mode and configured workspace root', () => {
    const summary = createRuntimeSummary({
      transport: 'long-connection',
      workspaceRoot: 'C:/workspace',
    });

    expect(summary).toContain('long-connection');
    expect(summary).toContain('C:/workspace');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/e2e-bridge.test.ts`
Expected: FAIL because `createRuntimeSummary` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function createRuntimeSummary(input: {
  transport: string;
  workspaceRoot: string;
}) {
  return `transport=${input.transport}; workspace=${input.workspaceRoot}`;
}
```

- [ ] **Step 4: Run verification suite**

Run: `npm test -- --run`
Expected: PASS with all tests green.

Run: `npm run build`
Expected: PASS with a successful TypeScript build.

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md src/index.ts tests/e2e-bridge.test.ts
git commit -m "feat: finalize bridge runtime flow and docs"
```
