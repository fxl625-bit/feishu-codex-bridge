import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBridgeApplication, createRuntimeSummary } from '../src/index.js';
import { createTaskStore } from '../src/task-store.js';

const tempDirectories: string[] = [];

async function createTempDataFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'feishu-e2e-'));
  tempDirectories.push(directory);
  return path.join(directory, 'tasks.json');
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('bridge application', () => {
  it('wires the Feishu transport, authorization, and task runtime together', async () => {
    const dataFile = await createTempDataFile();
    const store = createTaskStore({ dataFile });
    const outbound: Array<{ chatId: string; text: string }> = [];
    let registeredHandler: ((message: unknown) => Promise<void> | void) | undefined;

    const application = createBridgeApplication({
      config: {
        feishuAppId: 'app',
        feishuAppSecret: 'secret',
        allowedOpenIds: ['ou_1'],
        codexWorkspaceRoot: 'C:/workspace',
        codexModel: 'gpt-5.5',
        codexApprovalPolicy: 'never',
        codexSandboxMode: 'workspace-write',
        codexTimeoutMs: 60000,
        port: 8787,
      },
      transport: {
        onMessage(handler) {
          registeredHandler = handler;
        },
        async connect() {},
        async sendMessage(message) {
          outbound.push(message);
        },
      },
      store,
      runner: {
        run: vi.fn(async () => ({
          exitCode: 0,
          stdout: 'analysis complete',
          stderr: '',
          timedOut: false,
        })),
      },
    });

    await application.start();
    await registeredHandler?.({
      event: {
        sender: {
          sender_id: {
            open_id: 'ou_1',
          },
        },
        message: {
          message_id: 'om_1',
          chat_id: 'oc_1',
          message_type: 'text',
          content: JSON.stringify({ text: '/ask inspect repo' }),
        },
      },
    });
    await application.taskRuntime.idle();
    await vi.waitFor(() => {
      expect(outbound).toHaveLength(3);
    });

    expect(outbound[0]?.text).toContain('Request received. Starting task.');
    expect(outbound[1]?.text).toContain('Queued ask task');
    expect(outbound[2]?.text).toContain('analysis complete');
  });

  it('reports the runtime summary', () => {
    expect(
      createRuntimeSummary({
        transport: 'long-connection',
        workspaceRoot: 'C:/workspace',
      }),
    ).toContain('long-connection');
  });
});
