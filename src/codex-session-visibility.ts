import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface EnsureCodexSessionVisibleOptions {
  codexHomeDir: string;
  sessionId: string;
  prompt: string;
  updatedAt: string;
  workspaceRoot?: string;
}

interface SessionIndexEntry {
  id: string;
  thread_name: string;
  updated_at: string;
}

interface SessionSnapshot {
  cwd?: string;
  threadName?: string;
}

export function formatCodexThreadName(prompt: string): string {
  const normalized = prompt.replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return 'Feishu Session';
  }

  const shortened = normalized.length > 48 ? `${normalized.slice(0, 48).trimEnd()}...` : normalized;
  return `Feishu: ${shortened}`;
}

export async function ensureCodexSessionVisible(
  options: EnsureCodexSessionVisibleOptions,
): Promise<void> {
  const sessionFile = await findSessionFile(options.codexHomeDir, options.sessionId);
  if (!sessionFile) {
    return;
  }

  const sessionSnapshot = await readSessionSnapshot(sessionFile);
  const existingIndexEntry = await readSessionIndexEntry({
    sessionIndexFile: path.join(options.codexHomeDir, 'session_index.jsonl'),
    sessionId: options.sessionId,
  });
  const threadName =
    sessionSnapshot.threadName ??
    existingIndexEntry?.thread_name ??
    formatCodexThreadName(options.prompt);

  await ensureSessionFileHasThreadName({
    sessionFile,
    sessionId: options.sessionId,
    threadName,
    updatedAt: options.updatedAt,
  });
  await ensureSessionIndexEntry({
    sessionIndexFile: path.join(options.codexHomeDir, 'session_index.jsonl'),
    sessionId: options.sessionId,
    threadName,
    updatedAt: options.updatedAt,
  });
  await ensureGlobalStateVisibility({
    globalStateFile: path.join(options.codexHomeDir, '.codex-global-state.json'),
    sessionId: options.sessionId,
    workspaceRoot: sessionSnapshot.cwd ?? options.workspaceRoot,
  });
}

async function findSessionFile(codexHomeDir: string, sessionId: string): Promise<string | undefined> {
  const sessionsRoot = path.join(codexHomeDir, 'sessions');
  const matched = await walkForSessionFile(sessionsRoot, sessionId);
  return matched;
}

async function walkForSessionFile(directory: string, sessionId: string): Promise<string | undefined> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    const rawEntries = await readdir(directory, { withFileTypes: true });
    entries = rawEntries.map((entry) => ({
      name: String(entry.name),
      isDirectory: () => entry.isDirectory(),
      isFile: () => entry.isFile(),
    }));
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkForSessionFile(candidate, sessionId);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(`${sessionId}.jsonl`)) {
      return candidate;
    }
  }

  return undefined;
}

async function ensureSessionFileHasThreadName(input: {
  sessionFile: string;
  sessionId: string;
  threadName: string;
  updatedAt: string;
}): Promise<void> {
  const content = await readFile(input.sessionFile, 'utf8');
  if (content.includes(`"thread_name":"${escapeJsonString(input.threadName)}"`)) {
    return;
  }

  const lines = content.endsWith('\n') ? content : `${content}\n`;
  const appendedLine = JSON.stringify({
    timestamp: input.updatedAt,
    type: 'event_msg',
    payload: {
      type: 'thread_name_updated',
      thread_id: input.sessionId,
      thread_name: input.threadName,
    },
  });
  await writeFile(input.sessionFile, `${lines}${appendedLine}\n`, 'utf8');
}

async function readSessionIndexEntry(input: {
  sessionIndexFile: string;
  sessionId: string;
}): Promise<SessionIndexEntry | undefined> {
  let content = '';
  try {
    content = await readFile(input.sessionIndexFile, 'utf8');
  } catch {
    return undefined;
  }

  for (const line of content.split(/\r?\n/gu)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const entry = JSON.parse(trimmed) as SessionIndexEntry;
      if (entry.id === input.sessionId) {
        return entry;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

async function ensureSessionIndexEntry(input: {
  sessionIndexFile: string;
  sessionId: string;
  threadName: string;
  updatedAt: string;
}): Promise<void> {
  await mkdir(path.dirname(input.sessionIndexFile), { recursive: true });

  let content = '';
  try {
    content = await readFile(input.sessionIndexFile, 'utf8');
  } catch {
    content = '';
  }

  const entries = content
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SessionIndexEntry);

  const existing = entries.find((entry) => entry.id === input.sessionId);
  if (existing) {
    existing.thread_name = input.threadName;
    existing.updated_at = input.updatedAt;
  } else {
    entries.push({
      id: input.sessionId,
      thread_name: input.threadName,
      updated_at: input.updatedAt,
    });
  }

  entries.sort((left, right) => left.updated_at.localeCompare(right.updated_at));
  await writeFile(
    input.sessionIndexFile,
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf8',
  );
}

async function readSessionSnapshot(sessionFile: string): Promise<SessionSnapshot> {
  const content = await readFile(sessionFile, 'utf8');
  const snapshot: SessionSnapshot = {};

  for (const rawLine of content.split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as {
        type?: string;
        payload?: Record<string, unknown>;
      };

      if (entry.type === 'session_meta' && typeof entry.payload?.cwd === 'string') {
        snapshot.cwd = entry.payload.cwd;
      }

      if (
        entry.type === 'event_msg' &&
        entry.payload?.type === 'thread_name_updated' &&
        typeof entry.payload.thread_name === 'string'
      ) {
        snapshot.threadName = entry.payload.thread_name;
      }
    } catch {
      continue;
    }
  }

  return snapshot;
}

async function ensureGlobalStateVisibility(input: {
  globalStateFile: string;
  sessionId: string;
  workspaceRoot?: string;
}): Promise<void> {
  let state: Record<string, unknown> = {};
  try {
    state = JSON.parse(await readFile(input.globalStateFile, 'utf8')) as Record<string, unknown>;
  } catch {
    state = {};
  }

  const atomState = ensureObjectMap(state, 'electron-persisted-atom-state');
  const legacyProjectlessThreadIds = ensureStringArray(state, 'projectless-thread-ids');
  const projectlessThreadIds = ensureStringArray(atomState, 'projectless-thread-ids');
  mergeUniqueStrings(projectlessThreadIds, legacyProjectlessThreadIds);
  if (!projectlessThreadIds.includes(input.sessionId)) {
    projectlessThreadIds.push(input.sessionId);
  }

  const legacyWorkspaceHints = ensureStringMap(state, 'thread-workspace-root-hints');
  if (input.workspaceRoot) {
    const workspaceHints = ensureStringMap(atomState, 'thread-workspace-root-hints');
    mergeStringMap(workspaceHints, legacyWorkspaceHints);
    if (!workspaceHints[input.sessionId]) {
      workspaceHints[input.sessionId] = input.workspaceRoot;
    }
  } else {
    const workspaceHints = ensureStringMap(atomState, 'thread-workspace-root-hints');
    mergeStringMap(workspaceHints, legacyWorkspaceHints);
  }

  await writeFile(input.globalStateFile, JSON.stringify(state), 'utf8');
}

function ensureStringArray(target: Record<string, unknown>, key: string): string[] {
  const value = target[key];
  if (Array.isArray(value)) {
    const filtered = value.filter((entry): entry is string => typeof entry === 'string');
    target[key] = filtered;
    return filtered;
  }

  const created: string[] = [];
  target[key] = created;
  return created;
}

function ensureStringMap(target: Record<string, unknown>, key: string): Record<string, string> {
  const value = target[key];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const normalized: Record<string, string> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (typeof entryValue === 'string') {
        normalized[entryKey] = entryValue;
      }
    }

    target[key] = normalized;
    return normalized;
  }

  const created: Record<string, string> = {};
  target[key] = created;
  return created;
}

function ensureObjectMap(target: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = target[key];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  const created: Record<string, unknown> = {};
  target[key] = created;
  return created;
}

function mergeUniqueStrings(target: string[], source: string[]): void {
  for (const value of source) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function mergeStringMap(target: Record<string, string>, source: Record<string, string>): void {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) {
      target[key] = value;
    }
  }
}

function escapeJsonString(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}
