import { readJsonFile, writeJsonFile } from './utils/fs.js';
import type { NativeSessionBinding, NativeSessionBindingInput } from './types.js';

export interface NativeSessionStore {
  getByChatId(
    chatId: string,
    workerKind?: NativeSessionBinding['workerKind'],
  ): Promise<NativeSessionBinding | undefined>;
  upsert(input: NativeSessionBindingInput): Promise<NativeSessionBinding>;
  touch(
    chatId: string,
    workerKind?: NativeSessionBinding['workerKind'],
  ): Promise<NativeSessionBinding | undefined>;
  delete(chatId: string, workerKind?: NativeSessionBinding['workerKind']): Promise<void>;
  listExpired(now: string): Promise<NativeSessionBinding[]>;
}

interface NativeSessionStoreState {
  bindings: NativeSessionBinding[];
}

const EMPTY_STATE: NativeSessionStoreState = {
  bindings: [],
};

export function createNativeSessionStore(options: {
  dataFile: string;
  idleTimeoutMs: number;
}): NativeSessionStore {
  return {
    async getByChatId(chatId, workerKind) {
      const state = await loadState(options.dataFile);
      return cloneBinding(
        state.bindings.find(
          (binding) =>
            binding.chatId === chatId &&
            (workerKind === undefined || binding.workerKind === workerKind),
        ),
      );
    },

    async upsert(input) {
      const state = await loadState(options.dataFile);
      const index = state.bindings.findIndex(
        (binding) =>
          binding.chatId === input.chatId && binding.workerKind === input.workerKind,
      );
      const current = index >= 0 ? state.bindings[index] : undefined;
      const lastUsedAt = nextTimestamp(current?.lastUsedAt);
      const binding: NativeSessionBinding = {
        chatId: input.chatId,
        codexSessionId: input.codexSessionId,
        workerKind: input.workerKind,
        workspaceRoot: input.workspaceRoot,
        createdAt: current?.createdAt ?? lastUsedAt,
        lastUsedAt,
        expiresAt: createExpiryTimestamp(lastUsedAt, options.idleTimeoutMs),
      };

      if (index >= 0) {
        state.bindings[index] = binding;
      } else {
        state.bindings.push(binding);
      }

      await saveState(options.dataFile, state);
      return cloneBindingOrThrow(binding);
    },

    async touch(chatId, workerKind) {
      const state = await loadState(options.dataFile);
      const index = state.bindings.findIndex(
        (binding) =>
          binding.chatId === chatId &&
          (workerKind === undefined || binding.workerKind === workerKind),
      );

      if (index < 0) {
        return undefined;
      }

      const current = state.bindings[index];
      const lastUsedAt = nextTimestamp(current.lastUsedAt);
      const binding: NativeSessionBinding = {
        ...current,
        lastUsedAt,
        expiresAt: createExpiryTimestamp(lastUsedAt, options.idleTimeoutMs),
      };

      state.bindings[index] = binding;
      await saveState(options.dataFile, state);
      return cloneBindingOrThrow(binding);
    },

    async delete(chatId, workerKind) {
      const state = await loadState(options.dataFile);
      const bindings = state.bindings.filter(
        (binding) =>
          binding.chatId !== chatId ||
          (workerKind !== undefined && binding.workerKind !== workerKind),
      );

      if (bindings.length === state.bindings.length) {
        return;
      }

      await saveState(options.dataFile, { bindings });
    },

    async listExpired(now) {
      const state = await loadState(options.dataFile);
      return state.bindings
        .filter((binding) => binding.expiresAt <= now)
        .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))
        .map((binding) => cloneBindingOrThrow(binding));
    },
  };
}

async function loadState(dataFile: string): Promise<NativeSessionStoreState> {
  const state = await readJsonFile<NativeSessionStoreState>(dataFile, EMPTY_STATE);
  return {
    bindings: state.bindings.map((binding) => cloneBindingOrThrow(binding)),
  };
}

async function saveState(dataFile: string, state: NativeSessionStoreState): Promise<void> {
  await writeJsonFile(dataFile, {
    bindings: state.bindings.map((binding) => cloneBindingOrThrow(binding)),
  });
}

function cloneBinding(binding: NativeSessionBinding | undefined): NativeSessionBinding | undefined {
  if (!binding) {
    return undefined;
  }

  return { ...binding };
}

function cloneBindingOrThrow(binding: NativeSessionBinding): NativeSessionBinding {
  return { ...binding };
}

function nextTimestamp(previous?: string): string {
  const currentTime = Date.now();
  if (!previous) {
    return new Date(currentTime).toISOString();
  }

  const previousTime = Date.parse(previous);
  return new Date(Math.max(currentTime, previousTime + 1)).toISOString();
}

function createExpiryTimestamp(lastUsedAt: string, idleTimeoutMs: number): string {
  return new Date(Date.parse(lastUsedAt) + idleTimeoutMs).toISOString();
}
