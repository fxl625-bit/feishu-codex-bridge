import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationStore } from '../src/conversation-store.js';
import { createNativeSessionStore } from '../src/native-session-store.js';
import { createTaskRuntime } from '../src/runtime.js';
import { runSessionCli } from '../src/session-cli.js';
import { createTaskStore } from '../src/task-store.js';

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'feishu-session-cli-'));
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

function createCliHarness(directory: string) {
  const outbound: Array<{ chatId: string; text: string }> = [];
  const stdout: string[] = [];
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
    },
    runner: {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: 'Bridge continued.',
        stderr: '',
        timedOut: false,
      })),
    },
    nativeRunner: {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        sessionId: 'sess_1',
        lastMessage: 'Bridge continued.',
      })),
    },
    sendReply: async (reply) => {
      outbound.push(reply);
    },
  });

  return {
    outbound,
    stdout,
    store,
    conversationStore,
    runtime,
    writer: {
      write(value: string) {
        stdout.push(value);
      },
    },
  };
}

describe('session cli', () => {
  it('lists and shows sessions locally', async () => {
    const directory = await createTempDirectory();
    const harness = createCliHarness(directory);

    await harness.conversationStore.appendMessage({
      chatId: 'oc_1',
      participantOpenId: 'ou_1',
      direction: 'inbound',
      source: 'feishu',
      text: 'Please continue this task.',
    });

    await runSessionCli(['list'], {
      runtime: harness.runtime,
      store: harness.store,
      conversationStore: harness.conversationStore,
      stdout: harness.writer,
    });
    await runSessionCli(['show', 'session_oc_1'], {
      runtime: harness.runtime,
      store: harness.store,
      conversationStore: harness.conversationStore,
      stdout: harness.writer,
    });

    expect(harness.stdout.join('\n')).toContain('session_oc_1');
    expect(harness.stdout.join('\n')).toContain('Please continue this task.');
  });

  it('continues an existing session and sends the reply back to the same Feishu chat', async () => {
    const directory = await createTempDirectory();
    const harness = createCliHarness(directory);

    await harness.conversationStore.appendMessage({
      chatId: 'oc_1',
      participantOpenId: 'ou_1',
      direction: 'inbound',
      source: 'feishu',
      text: 'What changed?',
    });

    await runSessionCli(['ask', 'session_oc_1', 'Summarize the latest changes'], {
      runtime: harness.runtime,
      store: harness.store,
      conversationStore: harness.conversationStore,
      stdout: harness.writer,
    });

    expect(harness.outbound).toEqual([
      {
        chatId: 'oc_1',
        text: 'Bridge continued.',
      },
    ]);
    expect(harness.stdout.join('\n')).toContain('Bridge continued.');
  });
});
