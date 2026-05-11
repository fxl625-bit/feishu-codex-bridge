import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationStore } from '../src/conversation-store.js';
import { createNativeSessionStore } from '../src/native-session-store.js';
import type { BridgeInboundMessage } from '../src/bridge.js';
import { createTaskRuntime } from '../src/runtime.js';
import { createTaskStore } from '../src/task-store.js';

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'feishu-runtime-'));
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

function createInboundMessage(overrides: Partial<BridgeInboundMessage> = {}): BridgeInboundMessage {
  return {
    chatId: 'oc_1',
    messageId: 'om_1',
    senderOpenId: 'ou_1',
    text: '/ask inspect repo',
    ...overrides,
  };
}

function createRuntimeHarness(directory: string, overrides?: {
  nativeRunner?: { run: ReturnType<typeof vi.fn> };
}) {
  const replies: string[] = [];
  const store = createTaskStore({ dataFile: path.join(directory, 'tasks.json') });
  const conversationStore = createConversationStore({
    dataFile: path.join(directory, 'conversations.json'),
  });
  const nativeSessionStore = createNativeSessionStore({
    dataFile: path.join(directory, 'native-sessions.json'),
    idleTimeoutMs: 24 * 60 * 60 * 1000,
  });

  const runtime = createTaskRuntime({
    config: {
      codexWorkspaceRoot: 'C:/workspace',
      codexTimeoutMs: 60000,
      codexModel: 'gpt-5.5',
      codexApprovalPolicy: 'never',
      codexSandboxMode: 'workspace-write',
      nativeSessionIdleTimeoutMs: 24 * 60 * 60 * 1000,
    },
    store,
    conversationStore,
    nativeSessionStore,
    runtimePaths: {
      conversationsDir: path.join(directory, 'conversations'),
      archiveSyncDir: path.join(directory, 'archive'),
      runDir: path.join(directory, 'run'),
      nativeSessionRegistryFile: path.join(directory, 'native-sessions.json'),
      codexHomeDir: path.join(directory, '.codex'),
    },
    runner: {
      run: vi.fn(),
    },
    nativeRunner: overrides?.nativeRunner ?? {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        sessionId: 'sess_1',
        lastMessage: 'analysis complete',
      })),
    },
    sendReply: async (reply) => {
      replies.push(reply.text);
    },
  });

  return {
    replies,
    store,
    conversationStore,
    nativeSessionStore,
    runtime,
  };
}

async function seedNativeSessionArtifacts(directory: string, sessionId: string): Promise<void> {
  const sessionsDir = path.join(directory, '.codex', 'sessions', '2026', '05', '11');
  const sessionFile = path.join(sessionsDir, `rollout-2026-05-11T10-40-29-${sessionId}.jsonl`);
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    sessionFile,
    `${JSON.stringify({
      timestamp: '2026-05-11T02:40:30.066Z',
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp: '2026-05-11T02:40:29.837Z',
        cwd: 'C:/workspace',
        originator: 'Codex Desktop',
        cli_version: '0.120.0',
        source: 'exec',
      },
    })}\n`,
    'utf8',
  );
}

describe('task runtime', () => {
  it('runs ask tasks and replies only with the natural completion message', async () => {
    const directory = await createTempDirectory();
    const harness = createRuntimeHarness(directory);

    await seedNativeSessionArtifacts(directory, 'sess_1');

    await harness.runtime.handleInboundMessage(createInboundMessage());
    await harness.runtime.idle();

    expect(harness.replies).toEqual(['analysis complete']);
    await expect(harness.nativeSessionStore.getByChatId('oc_1', 'ask')).resolves.toMatchObject({
      codexSessionId: 'sess_1',
    });
    await expect(
      readFile(path.join(directory, 'conversations', 'session_oc_1.md'), 'utf8'),
    ).resolves.toContain('analysis complete');
  });

  it('reuses the same native session for repeated asks from one chat', async () => {
    const directory = await createTempDirectory();
    const nativeRunner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          sessionId: 'sess_1',
          lastMessage: 'first',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          sessionId: 'sess_1',
          lastMessage: 'second',
        }),
    };
    const harness = createRuntimeHarness(directory, { nativeRunner });

    await seedNativeSessionArtifacts(directory, 'sess_1');

    await harness.runtime.handleInboundMessage(createInboundMessage({ text: '/ask first' }));
    await harness.runtime.handleInboundMessage(
      createInboundMessage({ messageId: 'om_2', text: '/ask second' }),
    );
    await harness.runtime.idle();

    expect(harness.replies).toEqual(['first', 'second']);
    expect(nativeRunner.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        mode: 'start',
        prompt: 'first',
      }),
    );
    expect(nativeRunner.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        mode: 'resume',
        codexSessionId: 'sess_1',
        prompt: 'second',
      }),
    );

    const globalState = JSON.parse(
      await readFile(path.join(directory, '.codex', '.codex-global-state.json'), 'utf8'),
    ) as {
      'electron-persisted-atom-state': {
        'projectless-thread-ids': string[];
        'thread-workspace-root-hints': Record<string, string>;
      };
    };
    expect(globalState['electron-persisted-atom-state']['projectless-thread-ids']).toContain(
      'sess_1',
    );
    expect(
      globalState['electron-persisted-atom-state']['thread-workspace-root-hints'],
    ).toMatchObject({
      sess_1: 'C:/workspace',
    });
  });

  it('refreshes desktop-visible session state after a successful native resume', async () => {
    const directory = await createTempDirectory();
    const nativeRunner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          sessionId: 'sess_1',
          lastMessage: 'first',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          sessionId: 'sess_1',
          lastMessage: 'second',
        }),
    };
    const harness = createRuntimeHarness(directory, { nativeRunner });

    await seedNativeSessionArtifacts(directory, 'sess_1');

    await harness.runtime.handleInboundMessage(createInboundMessage({ text: '/ask first' }));
    await harness.runtime.handleInboundMessage(
      createInboundMessage({ messageId: 'om_2', text: '/ask second' }),
    );
    await harness.runtime.idle();

    const globalState = JSON.parse(
      await readFile(path.join(directory, '.codex', '.codex-global-state.json'), 'utf8'),
    ) as {
      'electron-persisted-atom-state': {
        'projectless-thread-ids': string[];
        'thread-workspace-root-hints': Record<string, string>;
      };
    };
    expect(globalState['electron-persisted-atom-state']['projectless-thread-ids']).toContain(
      'sess_1',
    );
    expect(
      globalState['electron-persisted-atom-state']['thread-workspace-root-hints'],
    ).toMatchObject({
      sess_1: 'C:/workspace',
    });
  });

  it('recreates a binding if native resume fails because the session no longer exists', async () => {
    const directory = await createTempDirectory();
    const nativeRunner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          sessionId: 'sess_1',
          lastMessage: 'first',
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Error: thread/resume: thread/resume failed: no rollout found for thread id sess_1',
          timedOut: false,
          sessionId: 'sess_1',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          sessionId: 'sess_2',
          lastMessage: 'recovered',
        }),
    };
    const harness = createRuntimeHarness(directory, { nativeRunner });

    await seedNativeSessionArtifacts(directory, 'sess_1');
    await seedNativeSessionArtifacts(directory, 'sess_2');

    await harness.runtime.handleInboundMessage(createInboundMessage({ text: '/ask first' }));
    await harness.runtime.handleInboundMessage(
      createInboundMessage({ messageId: 'om_2', text: '/ask second' }),
    );
    await harness.runtime.idle();

    expect(harness.replies).toEqual(['first', 'recovered']);
    expect(nativeRunner.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        mode: 'resume',
        codexSessionId: 'sess_1',
      }),
    );
    expect(nativeRunner.run).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        mode: 'start',
        prompt: 'second',
      }),
    );
    await expect(harness.nativeSessionStore.getByChatId('oc_1', 'ask')).resolves.toMatchObject({
      codexSessionId: 'sess_2',
    });
  });

  it('replies to plain text chat like natural conversation on success', async () => {
    const directory = await createTempDirectory();
    const harness = createRuntimeHarness(directory, {
      nativeRunner: {
        run: vi.fn(async () => ({
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          sessionId: 'sess_1',
          lastMessage: 'Here is the answer you asked for.',
        })),
      },
    });

    await seedNativeSessionArtifacts(directory, 'sess_1');

    await harness.runtime.handleInboundMessage(
      createInboundMessage({ text: 'What changed in this repo?' }),
    );
    await harness.runtime.idle();

    expect(harness.replies).toEqual(['Here is the answer you asked for.']);
  });

  it('keeps failed task replies concise and status-oriented', async () => {
    const directory = await createTempDirectory();
    const harness = createRuntimeHarness(directory, {
      nativeRunner: {
        run: vi.fn(async () => ({
          exitCode: 1,
          stdout: '',
          stderr: 'fatal: unable to inspect repository',
          timedOut: false,
        })),
      },
    });

    await harness.runtime.handleInboundMessage(createInboundMessage());
    await harness.runtime.idle();

    expect(harness.replies).toHaveLength(1);
    expect(harness.replies[0]).toContain('failed');
    expect(harness.replies[0]).toContain('fatal: unable to inspect repository');
  });

  it('returns the latest task status when /status is requested', async () => {
    const replies: string[] = [];
    const directory = await createTempDirectory();
    const store = createTaskStore({ dataFile: path.join(directory, 'tasks.json') });
    const conversationStore = createConversationStore({
      dataFile: path.join(directory, 'conversations.json'),
    });
    const nativeSessionStore = createNativeSessionStore({
      dataFile: path.join(directory, 'native-sessions.json'),
      idleTimeoutMs: 24 * 60 * 60 * 1000,
    });
    const task = await store.create({
      chatId: 'oc_1',
      sessionId: 'session_oc_1',
      senderOpenId: 'ou_1',
      kind: 'run',
      prompt: 'update README',
    });
    await store.update(task.id, {
      status: 'completed',
      summary: 'Updated README',
    });

    const runtime = createTaskRuntime({
      config: {
        codexWorkspaceRoot: 'C:/workspace',
        codexTimeoutMs: 60000,
        codexModel: 'gpt-5.5',
        codexApprovalPolicy: 'never',
        codexSandboxMode: 'workspace-write',
        nativeSessionIdleTimeoutMs: 24 * 60 * 60 * 1000,
      },
      store,
      conversationStore,
      nativeSessionStore,
      runtimePaths: {
        conversationsDir: path.join(directory, 'conversations'),
        archiveSyncDir: path.join(directory, 'archive'),
        runDir: path.join(directory, 'run'),
        nativeSessionRegistryFile: path.join(directory, 'native-sessions.json'),
        codexHomeDir: path.join(directory, '.codex'),
      },
      runner: {
        run: vi.fn(),
      },
      nativeRunner: {
        run: vi.fn(),
      },
      sendReply: async (reply) => {
        replies.push(reply.text);
      },
    });

    await runtime.handleInboundMessage(createInboundMessage({ text: '/status' }));

    expect(replies).toEqual([expect.stringContaining('Updated README')]);
  });

  it('answers session and history commands from the current chat session', async () => {
    const replies: string[] = [];
    const directory = await createTempDirectory();
    const store = createTaskStore({ dataFile: path.join(directory, 'tasks.json') });
    const conversationStore = createConversationStore({
      dataFile: path.join(directory, 'conversations.json'),
    });
    const nativeSessionStore = createNativeSessionStore({
      dataFile: path.join(directory, 'native-sessions.json'),
      idleTimeoutMs: 24 * 60 * 60 * 1000,
    });
    await conversationStore.appendMessage({
      chatId: 'oc_1',
      participantOpenId: 'ou_1',
      direction: 'inbound',
      source: 'feishu',
      text: 'How is the bridge doing?',
    });
    await conversationStore.appendMessage({
      chatId: 'oc_1',
      direction: 'outbound',
      source: 'codex',
      text: 'It is healthy.',
    });

    const runtime = createTaskRuntime({
      config: {
        codexWorkspaceRoot: 'C:/workspace',
        codexTimeoutMs: 60000,
        codexModel: 'gpt-5.5',
        codexApprovalPolicy: 'never',
        codexSandboxMode: 'workspace-write',
        nativeSessionIdleTimeoutMs: 24 * 60 * 60 * 1000,
      },
      store,
      conversationStore,
      nativeSessionStore,
      runtimePaths: {
        conversationsDir: path.join(directory, 'conversations'),
        archiveSyncDir: path.join(directory, 'archive'),
        runDir: path.join(directory, 'run'),
        nativeSessionRegistryFile: path.join(directory, 'native-sessions.json'),
        codexHomeDir: path.join(directory, '.codex'),
      },
      runner: {
        run: vi.fn(),
      },
      nativeRunner: {
        run: vi.fn(),
      },
      sendReply: async (reply) => {
        replies.push(reply.text);
      },
    });

    await runtime.handleInboundMessage(createInboundMessage({ text: '/session' }));
    await runtime.handleInboundMessage(createInboundMessage({ text: '/history 2' }));

    expect(replies[0]).toContain('session_oc_1');
    expect(replies[1]).toContain('It is healthy.');
  });
});
