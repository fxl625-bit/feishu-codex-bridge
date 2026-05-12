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
  readonly stdin = {
    chunks: [] as string[],
    ended: false,
    write: (chunk: string | Buffer, callback?: (error?: Error | null) => void) => {
      this.stdin.chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk);
      callback?.();
      return true;
    },
    end: (callback?: () => void) => {
      this.stdin.ended = true;
      callback?.();
    },
  };
  readonly kill = vi.fn(() => true);
}

function parseJsonRpcRequests(child: FakeChildProcess): Array<{
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
}> {
  return child.stdin.chunks
    .join('')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          id?: number | string;
          method?: string;
          params?: unknown;
          result?: unknown;
        },
    );
}

function respond(child: FakeChildProcess, message: unknown): void {
  child.stdout.write(`${JSON.stringify(message)}\n`);
}

function closeOk(child: FakeChildProcess): void {
  child.stdout.end();
  child.stderr.end();
  child.emit('close', 0, null);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('native session runner', () => {
  it('starts a native codex session through app-server and extracts the final answer', async () => {
    const child = new FakeChildProcess();
    const spawn = vi.fn(() => child);
    const runner = createNativeSessionRunner({ spawn, command: 'codex' });

    const resultPromise = runner.run({
      mode: 'start',
      prompt: 'hello',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
      sandboxMode: 'read-only',
      model: 'gpt-5-codex',
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
      expect(parseJsonRpcRequests(child).length).toBeGreaterThanOrEqual(1);
    });

    respond(child, { jsonrpc: '2.0', id: 1, result: { protocolVersion: 2 } });
    respond(child, {
      jsonrpc: '2.0',
      id: 2,
      result: {
        thread: {
          id: 'thread_1',
        },
      },
    });
    respond(child, { jsonrpc: '2.0', id: 3, result: {} });
    respond(child, {
      jsonrpc: '2.0',
      id: 4,
      result: {
        turn: {
          id: 'turn_1',
          status: 'inProgress',
          items: [],
        },
      },
    });
    respond(child, {
      jsonrpc: '2.0',
      method: 'item.completed',
      params: {
        item: {
          type: 'agentMessage',
          id: 'msg_1',
          phase: 'final_answer',
          text: 'Final answer from notification',
        },
      },
    });
    respond(child, {
      jsonrpc: '2.0',
      method: 'turn.completed',
      params: {
        turn: {
          id: 'turn_1',
          status: 'completed',
          items: [],
        },
      },
    });
    respond(child, {
      jsonrpc: '2.0',
      id: 5,
      result: {
        thread: {
          id: 'thread_1',
          turns: [
            {
              id: 'turn_1',
              status: 'completed',
              items: [
                {
                  type: 'agentMessage',
                  id: 'msg_0',
                  phase: 'commentary',
                  text: 'intermediate',
                },
                {
                  type: 'agentMessage',
                  id: 'msg_1',
                  phase: 'final_answer',
                  text: 'Final answer from thread/read',
                },
              ],
            },
          ],
        },
      },
    });
    closeOk(child);

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: 0,
      timedOut: false,
      sessionId: 'thread_1',
      lastMessage: 'Final answer from notification',
      finalMessage: 'Final answer from notification',
    });
    expect(spawn).toHaveBeenCalledWith(
      'codex',
      ['app-server', '--listen', 'stdio://'],
      expect.objectContaining({
        cwd: 'F:/CODEX/workspaces/feishu-codex',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );

    expect(parseJsonRpcRequests(child)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'initialize',
        }),
        expect.objectContaining({
          method: 'initialized',
        }),
        expect.objectContaining({
          method: 'thread/start',
        }),
      ]),
    );
  });

  it('resumes an existing native session through app-server and falls back to thread/read final answer', async () => {
    const child = new FakeChildProcess();
    const spawn = vi.fn(() => child);
    const runner = createNativeSessionRunner({ spawn, command: 'codex' });

    const resultPromise = runner.run({
      mode: 'resume',
      prompt: 'continue',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
      codexSessionId: 'sess_1',
      sandboxMode: 'workspace-write',
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
      expect(parseJsonRpcRequests(child).length).toBeGreaterThanOrEqual(1);
    });

    respond(child, { jsonrpc: '2.0', id: 1, result: { protocolVersion: 2 } });
    respond(child, {
      jsonrpc: '2.0',
      id: 2,
      result: {
        thread: {
          id: 'sess_1',
        },
      },
    });
    respond(child, { jsonrpc: '2.0', id: 3, result: {} });
    respond(child, {
      jsonrpc: '2.0',
      id: 4,
      result: {
        turn: {
          id: 'turn_2',
          status: 'inProgress',
          items: [],
        },
      },
    });
    respond(child, {
      jsonrpc: '2.0',
      method: 'turn.completed',
      params: {
        turn: {
          id: 'turn_2',
          status: 'completed',
          items: [],
        },
      },
    });
    respond(child, {
      jsonrpc: '2.0',
      id: 5,
      result: {
        thread: {
          id: 'sess_1',
          turns: [
            {
              id: 'turn_2',
              status: 'completed',
              items: [
                {
                  type: 'agentMessage',
                  id: 'msg_2',
                  text: 'Fallback final answer',
                },
              ],
            },
          ],
        },
      },
    });
    closeOk(child);

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: 0,
      sessionId: 'sess_1',
      lastMessage: 'Fallback final answer',
      finalMessage: 'Fallback final answer',
    });
    expect(parseJsonRpcRequests(child)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'initialize' }),
        expect.objectContaining({ method: 'initialized' }),
        expect.objectContaining({ method: 'thread/resume' }),
      ]),
    );
  });

  it('falls back to thread/set-name when thread/name/set is unsupported by the local app-server', async () => {
    const child = new FakeChildProcess();
    const spawn = vi.fn(() => child);
    const runner = createNativeSessionRunner({ spawn, command: 'codex' });

    const resultPromise = runner.run({
      mode: 'start',
      prompt: 'compat test',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
      sandboxMode: 'read-only',
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
      expect(parseJsonRpcRequests(child).length).toBeGreaterThanOrEqual(1);
    });

    respond(child, { jsonrpc: '2.0', id: 1, result: { protocolVersion: 2 } });
    respond(child, {
      jsonrpc: '2.0',
      id: 2,
      result: {
        thread: {
          id: 'thread_compat',
        },
      },
    });
    respond(child, {
      jsonrpc: '2.0',
      id: 3,
      error: {
        code: -32602,
        message:
          'Invalid request: unknown variant `thread/name/set`, expected one of `initialize`, `thread/start`',
        },
    });
    respond(child, {
      jsonrpc: '2.0',
      id: 4,
      result: {},
    });
    respond(child, {
      jsonrpc: '2.0',
      id: 5,
      result: {
        turn: {
          id: 'turn_compat',
          status: 'inProgress',
          items: [],
        },
      },
    });
    respond(child, {
      jsonrpc: '2.0',
      method: 'item.completed',
      params: {
        item: {
          type: 'agentMessage',
          id: 'msg_compat',
          phase: 'final_answer',
          text: 'Compatibility answer',
        },
      },
    });
    respond(child, {
      jsonrpc: '2.0',
      method: 'turn.completed',
      params: {
        turn: {
          id: 'turn_compat',
          status: 'completed',
          items: [],
        },
      },
    });
    respond(child, {
      jsonrpc: '2.0',
      id: 6,
      result: {
        thread: {
          id: 'thread_compat',
          turns: [
            {
              id: 'turn_compat',
              status: 'completed',
              items: [
                {
                  type: 'agentMessage',
                  id: 'msg_compat',
                  phase: 'final_answer',
                  text: 'Compatibility answer',
                },
              ],
            },
          ],
        },
      },
    });
    closeOk(child);

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: 0,
      sessionId: 'thread_compat',
      finalMessage: 'Compatibility answer',
      lastMessage: 'Compatibility answer',
    });
  });

  it('maps thread/resume missing-session failures to the existing error shape', async () => {
    const child = new FakeChildProcess();
    const spawn = vi.fn(() => child);
    const runner = createNativeSessionRunner({ spawn, command: 'codex' });

    const resultPromise = runner.run({
      mode: 'resume',
      prompt: 'continue',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
      codexSessionId: 'deadbeef',
      sandboxMode: 'workspace-write',
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
      expect(parseJsonRpcRequests(child).length).toBeGreaterThanOrEqual(1);
    });

    respond(child, { jsonrpc: '2.0', id: 1, result: { protocolVersion: 2 } });
    respond(child, {
      jsonrpc: '2.0',
      id: 2,
      error: {
        code: -32000,
        message: 'thread/resume failed: no rollout found for thread id deadbeef',
      },
    });
    child.stderr.end('');
    child.stdout.end();
    child.emit('close', 1, null);

    const result = await resultPromise;
    expect(result).toMatchObject({
      exitCode: 1,
      sessionId: 'deadbeef',
    });
    expect(result.stderr).toContain('thread/resume failed');
    expect(result.stderr).toContain('no rollout found');
    expect(isMissingNativeSessionError(result.stderr)).toBe(true);
  });

  it('terminates the app-server process on timeout', async () => {
    vi.useFakeTimers();

    const child = new FakeChildProcess();
    const spawn = vi.fn(() => child);
    const runner = createNativeSessionRunner({ spawn, command: 'codex' });

    const resultPromise = runner.run({
      mode: 'start',
      prompt: 'hello',
      workspaceRoot: 'F:/CODEX/workspaces/feishu-codex',
      sandboxMode: 'danger-full-access',
      timeoutMs: 50,
    });

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    child.stdout.end();
    child.stderr.end('');
    child.emit('close', null, 'SIGTERM');

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: null,
      timedOut: true,
      signal: 'SIGTERM',
    });
  });

  it('detects the missing-session resume error shape', () => {
    expect(
      isMissingNativeSessionError(
        'Error: thread/resume: thread/resume failed: no rollout found for thread id deadbeef',
      ),
    ).toBe(true);
    expect(
      isMissingNativeSessionError(
        'Error: thread/resume failed because missing-session state was detected for thread deadbeef',
      ),
    ).toBe(true);
    expect(isMissingNativeSessionError('some other failure')).toBe(false);
  });
});
