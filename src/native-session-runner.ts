import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CodexSandboxMode } from './types.js';

export interface NativeSessionRunRequest {
  mode: 'start' | 'resume';
  prompt: string;
  workspaceRoot: string;
  codexSessionId?: string;
  sandboxMode: CodexSandboxMode;
  timeoutMs?: number;
  tempDir?: string;
  model?: string;
}

export interface NativeSessionRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal?: NodeJS.Signals | null;
  lastMessage?: string;
  sessionId?: string;
  finalMessage?: string;
}

interface SpawnedProcess {
  stdin?: NodeJS.WritableStream | null;
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
    env: NodeJS.ProcessEnv;
    stdio: ['ignore', 'pipe', 'pipe'];
  },
) => SpawnedProcess;

export interface NativeSessionRunnerOptions {
  spawn?: SpawnLike;
  command?: string;
}

export function createNativeSessionRunner(options: NativeSessionRunnerOptions = {}) {
  const spawn = options.spawn ?? nodeSpawn;
  const command = options.command ?? resolveCodexCommand();

  return {
    async run(request: NativeSessionRunRequest): Promise<NativeSessionRunResult> {
      const outputCaptureDir = await mkdtemp(
        path.join(request.tempDir ?? os.tmpdir(), 'codex-native-session-'),
      );
      const outputLastMessageFile = path.join(outputCaptureDir, 'last-message.txt');

      try {
        return await new Promise<NativeSessionRunResult>((resolve, reject) => {
          const invocation = buildNativeInvocation(
            command,
            request,
            process.platform,
            outputLastMessageFile,
          );
          const child = spawn(invocation.command, invocation.args, {
            cwd: request.workspaceRoot,
            env: buildChildEnv(request.tempDir),
            stdio: ['ignore', 'pipe', 'pipe'],
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
            request.timeoutMs === undefined
              ? undefined
              : setTimeout(() => {
                  timedOut = true;
                  child.kill('SIGTERM');
                }, request.timeoutMs);

          child.once('error', (error) => {
            clearTimer(timeout);
            if (!settled) {
              settled = true;
              reject(error);
            }
          });

          child.once('close', async (code, signal) => {
            clearTimer(timeout);
            if (settled) {
              return;
            }

            settled = true;

            try {
              const stdout = Buffer.concat(stdoutChunks).toString('utf8');
              const lastMessage = await readOutputLastMessage(outputLastMessageFile);
              const sessionId =
                parseThreadIdFromJsonLines(stdout) ??
                (request.mode === 'resume' ? request.codexSessionId : undefined);

              resolve({
                exitCode: code,
                stdout,
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
                timedOut,
                signal,
                lastMessage,
                finalMessage: lastMessage,
                sessionId,
              });
            } catch (error) {
              reject(error);
            }
          });
        });
      } finally {
        await rm(outputCaptureDir, { recursive: true, force: true });
      }
    },
  };
}

export function isMissingNativeSessionError(stderr: string): boolean {
  const normalized = stderr.toLowerCase();
  return (
    normalized.includes('thread/resume failed') && normalized.includes('no rollout found') ||
    normalized.includes('no rollout found for thread id')
  );
}

function resolveCodexCommand(platform = process.platform, env = process.env): string {
  if (platform !== 'win32') {
    return 'codex';
  }

  const pathEntries = (env.PATH ?? '').split(';').filter(Boolean);
  for (const entry of pathEntries) {
    const cmdCandidate = path.join(entry, 'codex.cmd');
    if (existsSync(cmdCandidate)) {
      return cmdCandidate;
    }

    const exeCandidate = path.join(entry, 'codex.exe');
    if (existsSync(exeCandidate)) {
      return exeCandidate;
    }
  }

  return 'codex.cmd';
}

function buildNativeInvocation(
  command: string,
  request: NativeSessionRunRequest,
  platform = process.platform,
  outputLastMessageFile?: string,
): { command: string; args: string[] } {
  const args = buildNativeArgs(request, outputLastMessageFile);

  if (platform !== 'win32') {
    return {
      command,
      args,
    };
  }

  const entryPoint = resolveCodexEntryPoint(command);
  if (entryPoint) {
    return {
      command: process.execPath,
      args: [entryPoint, ...args],
    };
  }

  const escapedCommand = command.replace(/'/g, "''");
  const escapedArgs = args.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ');
  const script = `& '${escapedCommand}' @(${escapedArgs})`;

  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
  };
}

function resolveCodexEntryPoint(command: string): string | undefined {
  if (!path.isAbsolute(command)) {
    return undefined;
  }

  const entryPoint = path.join(
    path.dirname(command),
    'node_modules',
    '@openai',
    'codex',
    'bin',
    'codex.js',
  );
  return existsSync(entryPoint) ? entryPoint : undefined;
}

function buildNativeArgs(
  request: NativeSessionRunRequest,
  outputLastMessageFile?: string,
): string[] {
  const args: string[] = ['exec'];

  if (request.model) {
    args.push('-m', request.model);
  }

  args.push('-s', request.sandboxMode);

  if (request.mode === 'resume') {
    if (!request.codexSessionId) {
      throw new Error('codexSessionId is required when mode is resume');
    }

    args.push('resume', '--skip-git-repo-check', '--json');

    if (outputLastMessageFile) {
      args.push('--output-last-message', outputLastMessageFile);
    }

    args.push(request.codexSessionId, request.prompt);
    return args;
  }

  args.push('--skip-git-repo-check', '--json');

  if (outputLastMessageFile) {
    args.push('--output-last-message', outputLastMessageFile);
  }

  args.push(request.prompt);
  return args;
}

function buildChildEnv(tempDir: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (tempDir) {
    env.TEMP = tempDir;
    env.TMP = tempDir;
    env.TMPDIR = tempDir;
  }

  return env;
}

function clearTimer(timer: NodeJS.Timeout | undefined): void {
  if (timer) {
    clearTimeout(timer);
  }
}

async function readOutputLastMessage(filePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, 'utf8');
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function parseThreadIdFromJsonLines(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as { type?: string; thread_id?: string };
      if (parsed.type === 'thread.started' && typeof parsed.thread_id === 'string') {
        return parsed.thread_id;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}
