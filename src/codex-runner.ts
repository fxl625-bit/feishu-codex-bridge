import { spawn as nodeSpawn } from 'node:child_process';

export type CodexJobKind = 'ask' | 'run';

export interface CodexRunRequest {
  kind: CodexJobKind;
  prompt: string;
  workspaceRoot: string;
  timeoutMs?: number;
}

export interface CodexRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal?: NodeJS.Signals | null;
}

interface SpawnedProcess {
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'error', listener: (error: Error) => void): this;
  once(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

type SpawnLike = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    stdio: 'pipe';
  },
) => SpawnedProcess;

export interface CodexRunnerOptions {
  spawn?: SpawnLike;
  command?: string;
}

export function createCodexRunner(options: CodexRunnerOptions = {}) {
  const spawn = options.spawn ?? nodeSpawn;
  const command = options.command ?? 'codex';

  return {
    async run(job: CodexRunRequest): Promise<CodexRunResult> {
      return new Promise<CodexRunResult>((resolve, reject) => {
        const child = spawn(command, buildArgs(job), {
          cwd: job.workspaceRoot,
          stdio: 'pipe',
        });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let timedOut = false;
        let settled = false;

        child.stdout?.on('data', (chunk: string | Buffer) => {
          stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.stderr?.on('data', (chunk: string | Buffer) => {
          stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        const timeout =
          job.timeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                timedOut = true;
                child.kill('SIGTERM');
              }, job.timeoutMs);

        child.once('error', (error) => {
          clearTimer(timeout);
          if (!settled) {
            settled = true;
            reject(error);
          }
        });

        child.once('close', (code, signal) => {
          clearTimer(timeout);
          if (!settled) {
            settled = true;
            resolve({
              exitCode: code,
              stdout: Buffer.concat(stdoutChunks).toString('utf8'),
              stderr: Buffer.concat(stderrChunks).toString('utf8'),
              timedOut,
              signal,
            });
          }
        });
      });
    },
  };
}

function buildArgs(job: CodexRunRequest): string[] {
  return ['exec', '--sandbox-mode', sandboxModeFor(job.kind), job.prompt];
}

function sandboxModeFor(kind: CodexJobKind): string {
  return kind === 'ask' ? 'read-only' : 'workspace-write';
}

function clearTimer(timer: NodeJS.Timeout | undefined): void {
  if (timer) {
    clearTimeout(timer);
  }
}
