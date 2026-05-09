import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationStore } from '../src/conversation-store.js';
import { createBridgeApplication, createRuntimeSummary, startHealthServer } from '../src/index.js';
import { createTaskStore } from '../src/task-store.js';

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'feishu-e2e-'));
  tempDirectories.push(directory);
  return directory;
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
  it('wires the Feishu transport, authorization, and task runtime together with quiet chat replies', async () => {
    const directory = await createTempDirectory();
    const store = createTaskStore({ dataFile: path.join(directory, 'tasks.json') });
    const conversationStore = createConversationStore({
      dataFile: path.join(directory, 'conversations.json'),
    });
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
      conversationStore,
      runtimePaths: {
        serviceBaseDir: directory,
        dataDir: directory,
        logDir: directory,
        runDir: directory,
        tasksFile: path.join(directory, 'tasks.json'),
        conversationsFile: path.join(directory, 'conversations.json'),
        conversationsDir: path.join(directory, 'conversations'),
        stdoutLogFile: path.join(directory, 'stdout.log'),
        stderrLogFile: path.join(directory, 'stderr.log'),
        pidFile: path.join(directory, 'bridge.pid'),
        archiveSyncDir: path.join(directory, 'archive'),
        healthUrl: 'http://127.0.0.1:8787/health',
      },
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
      expect(outbound).toHaveLength(1);
    });

    expect(outbound[0]?.text).toContain('analysis complete');
    await expect(
      readFile(path.join(directory, 'conversations', 'session_oc_1.md'), 'utf8'),
    ).resolves.toContain('analysis complete');
  });

  it('reports the runtime summary', () => {
    expect(
      createRuntimeSummary({
        transport: 'long-connection',
        workspaceRoot: 'C:/workspace',
      }),
    ).toContain('long-connection');
  });

  it('serves health checks on the loopback interface', async () => {
    const server = startHealthServer(0, 'transport=long-connection; workspace=C:/workspace');

    await once(server, 'listening');
    const address = server.address();

    expect(address).not.toBeNull();
    expect(typeof address).toBe('object');
    expect(address && 'address' in address ? address.address : undefined).toBe('127.0.0.1');

    const port = typeof address === 'object' && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      summary: 'transport=long-connection; workspace=C:/workspace',
    });

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });
});
