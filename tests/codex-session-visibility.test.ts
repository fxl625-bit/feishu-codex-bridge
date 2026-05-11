import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureCodexSessionVisible, formatCodexThreadName } from '../src/codex-session-visibility.js';

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-session-visibility-'));
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

describe('codex session visibility', () => {
  it('formats a stable desktop-visible thread name from the first prompt', () => {
    expect(formatCodexThreadName('please reply bridge inbound ok')).toBe(
      'Feishu: please reply bridge inbound ok',
    );
    expect(formatCodexThreadName('   ')).toBe('Feishu Session');
  });

  it('adds missing desktop visibility state for a native session', async () => {
    const directory = await createTempDirectory();
    const codexHome = path.join(directory, '.codex');
    const sessionsDir = path.join(codexHome, 'sessions', '2026', '05', '11');
    const sessionFile = path.join(
      sessionsDir,
      'rollout-2026-05-11T10-40-29-019e14e8-5053-7b60-af61-6963d491b978.jsonl',
    );
    const sessionIndexFile = path.join(codexHome, 'session_index.jsonl');
    const globalStateFile = path.join(codexHome, '.codex-global-state.json');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          timestamp: '2026-05-11T02:40:30.066Z',
          type: 'session_meta',
          payload: {
            id: '019e14e8-5053-7b60-af61-6963d491b978',
            timestamp: '2026-05-11T02:40:29.837Z',
            cwd: 'F:/CODEX/workspaces/feishu-codex',
            originator: 'Codex Desktop',
            cli_version: '0.120.0',
            source: 'exec',
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-11T02:40:43.618Z',
          type: 'event_msg',
          payload: {
            type: 'task_complete',
            completed_at: 1778467243,
          },
        }),
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      sessionIndexFile,
      `${JSON.stringify({
        id: '019e1500-4275-7db1-9f23-914f8afd973d',
        thread_name: 'Implement DJ audibility telemetry',
        updated_at: '2026-05-11T03:06:49.4956201Z',
      })}\n`,
      'utf8',
    );
    await writeFile(
      globalStateFile,
      JSON.stringify({
        'projectless-thread-ids': ['019e1500-4275-7db1-9f23-914f8afd973d'],
        'thread-workspace-root-hints': {
          '019e1500-4275-7db1-9f23-914f8afd973d': 'C:/Users/example/Documents/Codex',
        },
      }),
      'utf8',
    );

    await ensureCodexSessionVisible({
      codexHomeDir: codexHome,
      sessionId: '019e14e8-5053-7b60-af61-6963d491b978',
      prompt: 'please reply bridge inbound ok',
      updatedAt: '2026-05-11T02:41:58.085Z',
    });

    const updatedIndex = await readFile(sessionIndexFile, 'utf8');
    expect(updatedIndex).toContain('019e14e8-5053-7b60-af61-6963d491b978');
    expect(updatedIndex).toContain('Feishu: please reply bridge inbound ok');

    const updatedSession = await readFile(sessionFile, 'utf8');
    expect(updatedSession).toContain('"type":"thread_name_updated"');
    expect(updatedSession).toContain('"thread_name":"Feishu: please reply bridge inbound ok"');

    const updatedGlobalState = JSON.parse(await readFile(globalStateFile, 'utf8')) as {
      'projectless-thread-ids': string[];
      'thread-workspace-root-hints': Record<string, string>;
    };
    expect(updatedGlobalState['projectless-thread-ids']).toContain(
      '019e14e8-5053-7b60-af61-6963d491b978',
    );
    expect(updatedGlobalState['thread-workspace-root-hints']).toMatchObject({
      '019e14e8-5053-7b60-af61-6963d491b978': 'F:/CODEX/workspaces/feishu-codex',
    });
  });

  it('preserves an existing thread name while backfilling desktop visibility state', async () => {
    const directory = await createTempDirectory();
    const codexHome = path.join(directory, '.codex');
    const sessionsDir = path.join(codexHome, 'sessions', '2026', '05', '11');
    const sessionFile = path.join(
      sessionsDir,
      'rollout-2026-05-11T10-40-29-019e14e8-5053-7b60-af61-6963d491b978.jsonl',
    );
    const sessionIndexFile = path.join(codexHome, 'session_index.jsonl');
    const globalStateFile = path.join(codexHome, '.codex-global-state.json');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          timestamp: '2026-05-11T02:40:30.066Z',
          type: 'session_meta',
          payload: {
            id: '019e14e8-5053-7b60-af61-6963d491b978',
            timestamp: '2026-05-11T02:40:29.837Z',
            cwd: 'F:/CODEX/workspaces/feishu-codex',
            originator: 'Codex Desktop',
            cli_version: '0.120.0',
            source: 'exec',
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-11T02:40:31.000Z',
          type: 'event_msg',
          payload: {
            type: 'thread_name_updated',
            thread_id: '019e14e8-5053-7b60-af61-6963d491b978',
            thread_name: 'Feishu: existing thread title',
          },
        }),
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      sessionIndexFile,
      `${JSON.stringify({
        id: '019e14e8-5053-7b60-af61-6963d491b978',
        thread_name: 'Feishu: existing thread title',
        updated_at: '2026-05-11T02:41:00.000Z',
      })}\n`,
      'utf8',
    );
    await writeFile(globalStateFile, JSON.stringify({}), 'utf8');

    await ensureCodexSessionVisible({
      codexHomeDir: codexHome,
      sessionId: '019e14e8-5053-7b60-af61-6963d491b978',
      prompt: 'a different later prompt should not rename the thread',
      updatedAt: '2026-05-11T02:41:58.085Z',
    });

    const updatedSession = await readFile(sessionFile, 'utf8');
    expect(updatedSession.match(/"type":"thread_name_updated"/gu)).toHaveLength(1);

    const updatedIndex = await readFile(sessionIndexFile, 'utf8');
    expect(updatedIndex).toContain('Feishu: existing thread title');
    expect(updatedIndex).not.toContain('a different later prompt should not rename the thread');
  });
});
