import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildInvocation, createCodexRunner, resolveCodexCommand } from '../src/codex-runner.js';

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('codex runner', () => {
  it('prefers the Windows launcher command on win32', () => {
    const command = resolveCodexCommand('win32', {
      PATH: 'C:\\Tools;C:\\Users\\yckj0094\\AppData\\Roaming\\npm',
    });

    expect(command.endsWith('codex.cmd')).toBe(true);
  });

  it('wraps Windows invocations through PowerShell', () => {
    const invocation = buildInvocation(
      'C:\\tools\\codex.cmd',
      {
        kind: 'ask',
        prompt: 'inspect repo',
        workspaceRoot: 'C:/workspace',
        approvalPolicy: 'never',
      },
      'win32',
    );

    expect(invocation.command).toBe('powershell.exe');
    expect(invocation.args.join(' ')).toContain('codex.cmd');
    expect(invocation.args.join(' ')).toContain("'inspect repo'");
  });

  it('prefers the Node entry point on Windows when the npm-installed codex package is available', () => {
    const invocation = buildInvocation(
      'C:\\Users\\yckj0094\\AppData\\Roaming\\npm\\codex.cmd',
      {
        kind: 'ask',
        prompt: 'reply bridge inbound ok',
        workspaceRoot: 'C:/workspace',
      },
      'win32',
    );

    expect(invocation.command).toBe(process.execPath);
    expect(invocation.args[0]?.replace(/\\/g, '/')).toContain('/@openai/codex/bin/codex.js');
    expect(invocation.args.at(-1)).toBe('reply bridge inbound ok');
  });

  it('adds output-last-message capture to the codex invocation', () => {
    const invocation = buildInvocation(
      'codex',
      {
        kind: 'ask',
        prompt: 'inspect repo',
        workspaceRoot: 'C:/workspace',
      },
      'linux',
      '/tmp/last-message.txt',
    );

    expect(invocation.command).toBe('codex');
    expect(invocation.args).toContain('--output-last-message');
    expect(invocation.args).toContain('--skip-git-repo-check');
    expect(invocation.args).toContain('/tmp/last-message.txt');
  });

  it('builds an ask-mode codex exec command and captures output', async () => {
    const child = new FakeChildProcess();
    const spawn = vi.fn(() => child);
    const runner = createCodexRunner({ spawn });

    const resultPromise = runner.run({
      kind: 'ask',
      prompt: 'inspect repo',
      workspaceRoot: 'C:/workspace',
      approvalPolicy: 'never',
      model: 'gpt-5.5',
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
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
      process.execPath,
      expect.arrayContaining([
        'exec',
        '-s',
        'read-only',
        '--skip-git-repo-check',
        '--output-last-message',
        expect.any(String),
        'inspect repo',
      ]),
      expect.objectContaining({
        cwd: 'C:/workspace',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
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
      sandboxMode: 'danger-full-access',
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
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
      process.execPath,
      expect.arrayContaining([
        'exec',
        '-s',
        'danger-full-access',
        '--skip-git-repo-check',
        '--output-last-message',
        expect.any(String),
        'update README',
      ]),
      expect.objectContaining({ cwd: 'C:/workspace', stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  });

  it('does not keep stdin open for the codex child process', async () => {
    const child = new FakeChildProcess();
    const spawn = vi.fn(() => child);
    const runner = createCodexRunner({ spawn });

    const resultPromise = runner.run({
      kind: 'ask',
      prompt: 'reply bridge inbound ok',
      workspaceRoot: 'C:/workspace',
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
    });

    child.stdout.end('');
    child.stderr.end('');
    child.emit('close', 0, null);

    await resultPromise;

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.any(Array),
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  });

  it('routes codex temporary files through the provided temp directory', async () => {
    const child = new FakeChildProcess();
    const spawn = vi.fn(() => child);
    const runner = createCodexRunner({ spawn });
    const tempDir = 'F:/CODEX/feishu-codex-bridge/run';

    const resultPromise = runner.run({
      kind: 'ask',
      prompt: 'reply only ok',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
      tempDir,
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
    });

    child.stdout.end('');
    child.stderr.end('');
    child.emit('close', 0, null);

    await resultPromise;

    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          TEMP: tempDir,
          TMP: tempDir,
          TMPDIR: tempDir,
        }),
      }),
    );
  });
});
