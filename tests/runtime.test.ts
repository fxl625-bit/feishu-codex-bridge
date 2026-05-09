import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationStore } from '../src/conversation-store.js';
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

describe('task runtime', () => {
  it('runs ask tasks and replies only with the natural completion message', async () => {
    const replies: string[] = [];
    const directory = await createTempDirectory();
    const store = createTaskStore({ dataFile: path.join(directory, 'tasks.json') });
    const conversationStore = createConversationStore({
      dataFile: path.join(directory, 'conversations.json'),
    });
    const runner = {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: 'analysis complete',
        stderr: '',
        timedOut: false,
      })),
    };

    const runtime = createTaskRuntime({
      config: {
        codexWorkspaceRoot: 'C:/workspace',
        codexTimeoutMs: 60000,
        codexModel: 'gpt-5.5',
        codexApprovalPolicy: 'never',
        codexSandboxMode: 'workspace-write',
      },
      store,
      conversationStore,
      runtimePaths: {
        conversationsDir: path.join(directory, 'conversations'),
        archiveSyncDir: path.join(directory, 'archive'),
        runDir: path.join(directory, 'run'),
      },
      runner,
      sendReply: async (reply) => {
        replies.push(reply.text);
      },
    });

    await runtime.handleInboundMessage(createInboundMessage());
    await runtime.idle();

    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ask',
        prompt: 'inspect repo',
        workspaceRoot: 'C:/workspace',
        timeoutMs: 60000,
      }),
    );
    expect(replies).toEqual(['analysis complete']);
    await expect(
      readFile(path.join(directory, 'conversations', 'session_oc_1.md'), 'utf8'),
    ).resolves.toContain('analysis complete');
  });

  it('replies to plain text chat like natural conversation on success', async () => {
    const replies: string[] = [];
    const directory = await createTempDirectory();
    const store = createTaskStore({ dataFile: path.join(directory, 'tasks.json') });
    const conversationStore = createConversationStore({
      dataFile: path.join(directory, 'conversations.json'),
    });
    const runner = {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: 'Here is the answer you asked for.',
        stderr: '',
        timedOut: false,
      })),
    };

    const runtime = createTaskRuntime({
      config: {
        codexWorkspaceRoot: 'C:/workspace',
        codexTimeoutMs: 60000,
        codexModel: 'gpt-5.5',
        codexApprovalPolicy: 'never',
        codexSandboxMode: 'workspace-write',
      },
      store,
      conversationStore,
      runtimePaths: {
        conversationsDir: path.join(directory, 'conversations'),
        archiveSyncDir: path.join(directory, 'archive'),
        runDir: path.join(directory, 'run'),
      },
      runner,
      sendReply: async (reply) => {
        replies.push(reply.text);
      },
    });

    await runtime.handleInboundMessage(createInboundMessage({ text: 'What changed in this repo?' }));
    await runtime.idle();

    expect(replies).toEqual(['Here is the answer you asked for.']);
  });

  it('keeps failed task replies concise and status-oriented', async () => {
    const replies: string[] = [];
    const directory = await createTempDirectory();
    const store = createTaskStore({ dataFile: path.join(directory, 'tasks.json') });
    const conversationStore = createConversationStore({
      dataFile: path.join(directory, 'conversations.json'),
    });
    const runner = {
      run: vi.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'fatal: unable to inspect repository',
        timedOut: false,
      })),
    };

    const runtime = createTaskRuntime({
      config: {
        codexWorkspaceRoot: 'C:/workspace',
        codexTimeoutMs: 60000,
        codexModel: 'gpt-5.5',
        codexApprovalPolicy: 'never',
        codexSandboxMode: 'workspace-write',
      },
      store,
      conversationStore,
      runtimePaths: {
        conversationsDir: path.join(directory, 'conversations'),
        archiveSyncDir: path.join(directory, 'archive'),
        runDir: path.join(directory, 'run'),
      },
      runner,
      sendReply: async (reply) => {
        replies.push(reply.text);
      },
    });

    await runtime.handleInboundMessage(createInboundMessage());
    await runtime.idle();

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('failed');
    expect(replies[0]).toContain('fatal: unable to inspect repository');
  });

  it('returns the latest task status when /status is requested', async () => {
    const replies: string[] = [];
    const directory = await createTempDirectory();
    const store = createTaskStore({ dataFile: path.join(directory, 'tasks.json') });
    const conversationStore = createConversationStore({
      dataFile: path.join(directory, 'conversations.json'),
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
        codexModel: undefined,
        codexApprovalPolicy: 'never',
        codexSandboxMode: 'workspace-write',
      },
      store,
      conversationStore,
      runtimePaths: {
        conversationsDir: path.join(directory, 'conversations'),
        archiveSyncDir: path.join(directory, 'archive'),
        runDir: path.join(directory, 'run'),
      },
      runner: {
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
        codexModel: undefined,
        codexApprovalPolicy: 'never',
        codexSandboxMode: 'workspace-write',
      },
      store,
      conversationStore,
      runtimePaths: {
        conversationsDir: path.join(directory, 'conversations'),
        archiveSyncDir: path.join(directory, 'archive'),
        runDir: path.join(directory, 'run'),
      },
      runner: {
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
