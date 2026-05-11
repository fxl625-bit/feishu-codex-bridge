import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createNativeSessionRunner,
  isMissingNativeSessionError,
} from '../src/native-session-runner.js';

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('native session runner', () => {
  it('starts a native codex session for a first prompt', async () => {
    const child = new FakeChildProcess();
    const spawn = vi.fn(() => child);
    const runner = createNativeSessionRunner({ spawn });

    const resultPromise = runner.run({
      mode: 'start',
      prompt: 'hello',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
      sandboxMode: 'read-only',
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
    });

    child.stdout.end('{"type":"thread.started","thread_id":"sess_1"}\n');
    child.stderr.end('');
    child.emit('close', 0, null);

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: 0,
      sessionId: 'sess_1',
    });
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['exec', '-s', 'read-only', '--skip-git-repo-check', '--json', 'hello']),
      expect.objectContaining({
        cwd: 'F:/CODEX/workspaces/feishu-codex',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  });

  it('resumes an existing native codex session id', async () => {
    const child = new FakeChildProcess();
    const spawn = vi.fn(() => child);
    const runner = createNativeSessionRunner({ spawn });

    const resultPromise = runner.run({
      mode: 'resume',
      prompt: 'continue',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
      codexSessionId: 'sess_1',
      sandboxMode: 'workspace-write',
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
    });

    child.stdout.end('{"type":"thread.started","thread_id":"sess_1"}\n');
    child.stderr.end('');
    child.emit('close', 0, null);

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: 0,
      sessionId: 'sess_1',
    });
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([
        'exec',
        '-s',
        'workspace-write',
        'resume',
        '--skip-git-repo-check',
        '--json',
        'sess_1',
        'continue',
      ]),
      expect.any(Object),
    );
  });

  it('detects the missing-session resume error shape', () => {
    expect(
      isMissingNativeSessionError(
        'Error: thread/resume: thread/resume failed: no rollout found for thread id deadbeef',
      ),
    ).toBe(true);
    expect(isMissingNativeSessionError('some other failure')).toBe(false);
  });
});
