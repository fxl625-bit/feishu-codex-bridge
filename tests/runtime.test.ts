import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeInboundMessage } from '../src/bridge.js';
import { createTaskRuntime } from '../src/runtime.js';
import { createTaskStore } from '../src/task-store.js';

const tempDirectories: string[] = [];

async function createTempDataFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'feishu-runtime-'));
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
  it('queues ask tasks, runs codex, and replies with progress updates', async () => {
    const replies: string[] = [];
    const dataFile = await createTempDataFile();
    const store = createTaskStore({ dataFile });
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
    expect(replies[0]).toContain('Queued ask task');
    expect(replies[1]).toContain('analysis complete');
  });

  it('returns the latest task status when /status is requested', async () => {
    const replies: string[] = [];
    const dataFile = await createTempDataFile();
    const store = createTaskStore({ dataFile });
    const task = await store.create({
      chatId: 'oc_1',
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
});
