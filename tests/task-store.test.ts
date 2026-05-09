import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTaskStore } from '../src/task-store.js';

const tempDirectories: string[] = [];

async function createTempDataFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'feishu-task-store-'));
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

describe('task store', () => {
  it('creates and retrieves queued tasks', async () => {
    const dataFile = await createTempDataFile();
    const store = createTaskStore({ dataFile });

    const task = await store.create({
      chatId: 'oc_1',
      sessionId: 'session_oc_1',
      senderOpenId: 'ou_1',
      kind: 'ask',
      prompt: 'inspect repo',
    });

    const loaded = await store.get(task.id);

    expect(loaded).toMatchObject({
      id: task.id,
      chatId: 'oc_1',
      sessionId: 'session_oc_1',
      senderOpenId: 'ou_1',
      kind: 'ask',
      prompt: 'inspect repo',
      status: 'queued',
    });
    expect(loaded?.createdAt).toEqual(loaded?.updatedAt);
  });

  it('persists task updates to disk for new store instances', async () => {
    const dataFile = await createTempDataFile();
    const store = createTaskStore({ dataFile });
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
      result: {
        exitCode: 0,
        stdout: 'done',
        stderr: '',
        timedOut: false,
      },
    });

    const reloadedStore = createTaskStore({ dataFile });
    const loaded = await reloadedStore.get(task.id);

    expect(loaded).toMatchObject({
      id: task.id,
      sessionId: 'session_oc_1',
      status: 'completed',
      summary: 'Updated README',
      result: {
        exitCode: 0,
        stdout: 'done',
        stderr: '',
        timedOut: false,
      },
    });
    expect(loaded?.updatedAt).not.toBe(task.updatedAt);
  });

  it('returns the latest task for a sender', async () => {
    const dataFile = await createTempDataFile();
    const store = createTaskStore({ dataFile });

    await store.create({
      chatId: 'oc_1',
      sessionId: 'session_oc_1',
      senderOpenId: 'ou_1',
      kind: 'ask',
      prompt: 'first',
    });
    const latestTask = await store.create({
      chatId: 'oc_1',
      sessionId: 'session_oc_1',
      senderOpenId: 'ou_1',
      kind: 'run',
      prompt: 'second',
    });

    await store.create({
      chatId: 'oc_2',
      sessionId: 'session_oc_2',
      senderOpenId: 'ou_2',
      kind: 'ask',
      prompt: 'other',
    });

    await expect(store.getLatestBySenderOpenId('ou_1')).resolves.toMatchObject({
      id: latestTask.id,
      prompt: 'second',
    });
  });
});
