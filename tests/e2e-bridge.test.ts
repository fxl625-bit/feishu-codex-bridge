import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationStore } from '../src/conversation-store.js';
import { createNativeSessionStore } from '../src/native-session-store.js';
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
  it('reuses the same native worker session for repeated chat messages', async () => {
    const directory = await createTempDirectory();
    const store = createTaskStore({ dataFile: path.join(directory, 'tasks.json') });
    const conversationStore = createConversationStore({
      dataFile: path.join(directory, 'conversations.json'),
    });
    const nativeSessionStore = createNativeSessionStore({
      dataFile: path.join(directory, 'native-sessions.json'),
      idleTimeoutMs: 24 * 60 * 60 * 1000,
    });
    const outbound: Array<{ chatId: string; text: string }> = [];
    let registeredHandler: ((message: unknown) => Promise<void> | void) | undefined;
    const nativeRunner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          sessionId: 'sess_1',
          lastMessage: 'analysis complete',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          sessionId: 'sess_1',
          lastMessage: 'analysis resumed',
        }),
    };

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
        nativeSessionIdleTimeoutMs: 24 * 60 * 60 * 1000,
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
      nativeSessionStore,
      runtimePaths: {
        serviceBaseDir: directory,
        dataDir: directory,
        logDir: directory,
        runDir: directory,
        tasksFile: path.join(directory, 'tasks.json'),
        conversationsFile: path.join(directory, 'conversations.json'),
        conversationsDir: path.join(directory, 'conversations'),
        nativeSessionRegistryFile: path.join(directory, 'native-sessions.json'),
        stdoutLogFile: path.join(directory, 'stdout.log'),
        stderrLogFile: path.join(directory, 'stderr.log'),
        pidFile: path.join(directory, 'bridge.pid'),
        archiveSyncDir: path.join(directory, 'archive'),
        healthUrl: 'http://127.0.0.1:8787/health',
      },
      runner: {
        run: vi.fn(),
      },
      nativeRunner,
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
    await registeredHandler?.({
      event: {
        sender: {
          sender_id: {
            open_id: 'ou_1',
          },
        },
        message: {
          message_id: 'om_2',
          chat_id: 'oc_1',
          message_type: 'text',
          content: JSON.stringify({ text: '/ask inspect again' }),
        },
      },
    });
    await application.taskRuntime.idle();
    await vi.waitFor(() => {
      expect(outbound).toHaveLength(2);
    });

    expect(outbound[0]?.text).toContain('analysis complete');
    expect(outbound[1]?.text).toContain('analysis resumed');
    expect(nativeRunner.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mode: 'start' }),
    );
    expect(nativeRunner.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: 'resume', codexSessionId: 'sess_1' }),
    );
    await expect(
      readFile(path.join(directory, 'conversations', 'session_oc_1.md'), 'utf8'),
    ).resolves.toContain('analysis resumed');
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
