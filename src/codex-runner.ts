import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CodexApprovalPolicy, CodexSandboxMode } from './types.js';

export type CodexJobKind = 'ask' | 'run';

export interface CodexRunRequest {
  kind: CodexJobKind;
  prompt: string;
  workspaceRoot: string;
  tempDir?: string;
  timeoutMs?: number;
  model?: string;
  approvalPolicy?: CodexApprovalPolicy;
  sandboxMode?: CodexSandboxMode;
}

export interface CodexRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal?: NodeJS.Signals | null;
  lastMessage?: string;
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

export interface CodexRunnerOptions {
  spawn?: SpawnLike;
  command?: string;
}

export function createCodexRunner(options: CodexRunnerOptions = {}) {
  const spawn = options.spawn ?? nodeSpawn;
  const command = options.command ?? resolveCodexCommand();

  return {
    async run(job: CodexRunRequest): Promise<CodexRunResult> {
      const outputCaptureDir = await mkdtemp(
        path.join(job.tempDir ?? os.tmpdir(), 'codex-last-message-'),
      );
      const outputLastMessageFile = path.join(outputCaptureDir, 'last-message.txt');

      try {
        return await new Promise<CodexRunResult>((resolve, reject) => {
          const invocation = buildInvocation(command, job, process.platform, outputLastMessageFile);
          const child = spawn(invocation.command, invocation.args, {
            cwd: job.workspaceRoot,
            env: buildChildEnv(job),
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

          child.once('close', async (code, signal) => {
            clearTimer(timeout);
            if (settled) {
              return;
            }

            settled = true;

            try {
              resolve({
                exitCode: code,
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
                timedOut,
                signal,
                lastMessage: await readOutputLastMessage(outputLastMessageFile),
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

export function resolveCodexCommand(platform = process.platform, env = process.env): string {
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

export function buildInvocation(
  command: string,
  job: CodexRunRequest,
  platform = process.platform,
  outputLastMessageFile?: string,
): { command: string; args: string[] } {
  const args = buildArgs(job, outputLastMessageFile);

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

  const entryPoint = path.join(path.dirname(command), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  return existsSync(entryPoint) ? entryPoint : undefined;
}

function buildArgs(job: CodexRunRequest, outputLastMessageFile?: string): string[] {
  const args: string[] = [];

  if (job.approvalPolicy) {
    args.push('-a', job.approvalPolicy);
  }

  if (job.model) {
    args.push('-m', job.model);
  }

  args.push('exec', '-s', sandboxModeFor(job));
  args.push('--skip-git-repo-check');

  if (outputLastMessageFile) {
    args.push('--output-last-message', outputLastMessageFile);
  }

  args.push(job.prompt);

  return args;
}

function sandboxModeFor(job: CodexRunRequest): CodexSandboxMode {
  if (job.kind === 'ask') {
    return 'read-only';
  }

  return job.sandboxMode ?? 'workspace-write';
}

function buildChildEnv(job: CodexRunRequest): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (job.tempDir) {
    env.TEMP = job.tempDir;
    env.TMP = job.tempDir;
    env.TMPDIR = job.tempDir;
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
