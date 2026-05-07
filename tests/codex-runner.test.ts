import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCodexRunner } from '../src/codex-runner.js';

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('codex runner', () => {
  it('builds an ask-mode codex exec command and captures output', async () => {
    const child = new FakeChildProcess();
    const spawn = vi.fn(() => child);
    const runner = createCodexRunner({ spawn });

    const resultPromise = runner.run({
      kind: 'ask',
      prompt: 'inspect repo',
      workspaceRoot: 'C:/workspace',
    });

    child.stdout.end('analysis complete');
    child.stderr.end('');
    child.emit('close', 0, null);

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: 0,
      stdout: 'analysis complete',
      stderr: '',
      timedOut: false,
    });
    expect(spawn).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['exec', '--sandbox-mode', 'read-only', 'inspect repo']),
      expect.objectContaining({ cwd: 'C:/workspace' }),
    );
  });

  it('kills the process when the timeout expires', async () => {
    vi.useFakeTimers();

    const child = new FakeChildProcess();
    const spawn = vi.fn(() => child);
    const runner = createCodexRunner({ spawn });

    const resultPromise = runner.run({
      kind: 'run',
      prompt: 'update README',
      workspaceRoot: 'C:/workspace',
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(25);
    child.stdout.end('');
    child.stderr.end('timed out');
    child.emit('close', null, 'SIGTERM');

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: null,
      stderr: 'timed out',
      timedOut: true,
      signal: 'SIGTERM',
    });
    expect(child.kill).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['exec', '--sandbox-mode', 'workspace-write', 'update README']),
      expect.objectContaining({ cwd: 'C:/workspace' }),
    );
  });
});
