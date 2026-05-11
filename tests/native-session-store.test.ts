import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNativeSessionStore } from '../src/native-session-store.js';

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-session-store-'));
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

describe('native session store', () => {
  it('creates and reloads a chat binding', async () => {
    const directory = await createTempDirectory();
    const dataFile = path.join(directory, 'native-sessions.json');
    const store = createNativeSessionStore({
      dataFile,
      idleTimeoutMs: 24 * 60 * 60 * 1000,
    });

    await store.upsert({
      chatId: 'oc_1',
      codexSessionId: 'sess_1',
      workerKind: 'ask',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
    });

    const reloadedStore = createNativeSessionStore({
      dataFile,
      idleTimeoutMs: 24 * 60 * 60 * 1000,
    });

    const binding = await reloadedStore.getByChatId('oc_1');
    expect(binding?.codexSessionId).toBe('sess_1');
    expect(binding?.expiresAt).toBeDefined();
  });

  it('touches a binding and extends its expiry from the new last-used time', async () => {
    const directory = await createTempDirectory();
    const store = createNativeSessionStore({
      dataFile: path.join(directory, 'native-sessions.json'),
      idleTimeoutMs: 60_000,
    });

    const created = await store.upsert({
      chatId: 'oc_1',
      codexSessionId: 'sess_1',
      workerKind: 'ask',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const touched = await store.touch('oc_1');
    expect(touched).toBeDefined();
    expect(Date.parse(touched!.lastUsedAt)).toBeGreaterThan(Date.parse(created.lastUsedAt));
    expect(Date.parse(touched!.expiresAt) - Date.parse(touched!.lastUsedAt)).toBe(60_000);
  });

  it('lists expired bindings and deletes them by chat id', async () => {
    const directory = await createTempDirectory();
    const store = createNativeSessionStore({
      dataFile: path.join(directory, 'native-sessions.json'),
      idleTimeoutMs: 60_000,
    });

    const active = await store.upsert({
      chatId: 'oc_active',
      codexSessionId: 'sess_active',
      workerKind: 'run',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
    });
    const expired = await store.upsert({
      chatId: 'oc_expired',
      codexSessionId: 'sess_expired',
      workerKind: 'ask',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const refreshedActive = await store.touch('oc_active', 'run');
    const expiredBindings = await store.listExpired(expired.expiresAt);

    expect(expiredBindings.map((binding) => binding.chatId)).toEqual(['oc_expired']);
    expect(expiredBindings[0]?.codexSessionId).toBe('sess_expired');
    expect(expiredBindings.some((binding) => binding.chatId === refreshedActive?.chatId)).toBe(false);

    await store.delete('oc_expired');
    await expect(store.getByChatId('oc_expired')).resolves.toBeUndefined();
  });
});
