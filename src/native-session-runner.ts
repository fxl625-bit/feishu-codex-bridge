import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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

interface ClosableStdin {
  write(chunk: string | Buffer, callback?: (error?: Error | null) => void): boolean;
  end(callback?: () => void): void;
}

type SpawnLike = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: ['pipe', 'pipe', 'pipe'];
  },
) => SpawnedProcess;

export interface NativeSessionRunnerOptions {
  spawn?: SpawnLike;
  command?: string;
}

interface JsonRpcSuccess {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
}

interface JsonRpcError {
  jsonrpc?: string;
  id?: number | string;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface JsonRpcNotification {
  jsonrpc?: string;
  method?: string;
  params?: unknown;
}

interface ThreadRef {
  id?: string;
}

interface TurnRef {
  id?: string;
  status?: string;
  error?: {
    message?: string;
  };
}

interface AgentMessageItem {
  type?: string;
  phase?: string | null;
  text?: string;
}

interface ThreadReadTurn {
  id?: string;
  status?: string;
  items?: ThreadReadItem[];
}

type ThreadReadItem = AgentMessageItem & { id?: string };

interface ThreadResponse {
  thread?: ThreadRef;
}

interface ThreadReadResponse {
  thread?: {
    turns?: ThreadReadTurn[];
  };
}

const CLIENT_INFO = {
  name: 'feishu-codex-bridge',
  version: '1.0.0',
} as const;

export function createNativeSessionRunner(options: NativeSessionRunnerOptions = {}) {
  const spawn = options.spawn ?? nodeSpawn;
  const command = options.command ?? resolveCodexCommand();

  return {
    async run(request: NativeSessionRunRequest): Promise<NativeSessionRunResult> {
      return await new Promise<NativeSessionRunResult>((resolve, reject) => {
        const invocation = buildNativeInvocation(command, process.platform);
        const child = spawn(invocation.command, invocation.args, {
          cwd: request.workspaceRoot,
          env: buildChildEnv(request.tempDir),
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutText = '';
        let timedOut = false;
        let settled = false;
        let nextRequestId = 1;
        let sessionId = request.mode === 'resume' ? request.codexSessionId : undefined;
        let currentTurnId: string | undefined;
        let notificationFinalMessage: string | undefined;
        let rpcFailureMessage: string | undefined;
        let threadReadTurns: ThreadReadTurn[] = [];
        let threadReadRaw: unknown;
        let requestedShutdown = false;
        let shutdownForced = false;
        let shutdownTimer: NodeJS.Timeout | undefined;

        const pendingRequests = new Map<
          number,
          {
            resolve: (value: unknown) => void;
            reject: (error: Error) => void;
          }
        >();

        let awaitTurnCompletion:
          | {
              resolve: () => void;
              reject: (error: Error) => void;
            }
          | undefined;

        const timeout =
          request.timeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                timedOut = true;
                child.kill('SIGTERM');
              }, request.timeoutMs);

        child.stdout?.on('data', (chunk: string | Buffer) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          stdoutChunks.push(buffer);
          stdoutText += buffer.toString('utf8');
          drainStdout();
        });

        child.stderr?.on('data', (chunk: string | Buffer) => {
          stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        child.once('error', (error) => {
          clearTimer(timeout);
          clearTimer(shutdownTimer);
          rejectPending(error);
          if (!settled) {
            settled = true;
            reject(error);
          }
        });

        child.once('close', async (code, signal) => {
          clearTimer(timeout);
          clearTimer(shutdownTimer);
          rejectPending(new Error('codex app-server process closed'));

          if (settled) {
            return;
          }

          settled = true;

          if (threadReadRaw !== undefined) {
            stdoutChunks.push(Buffer.from(`${JSON.stringify(threadReadRaw)}\n`, 'utf8'));
          }

          const stdout = Buffer.concat(stdoutChunks).toString('utf8');
          const stderrBody = Buffer.concat(stderrChunks).toString('utf8');
          const stderr =
            [rpcFailureMessage, extractRpcFailureMessageFromStdout(stdout), stderrBody]
              .filter(Boolean)
              .join('\n')
              .trim();

          sessionId ??= extractSessionIdFromStdout(stdout);

          const finalMessage =
            notificationFinalMessage ??
            extractFinalMessageFromTurns(threadReadTurns, currentTurnId) ??
            extractFinalMessageFromStdout(stdout, currentTurnId);

          const exitCode =
            requestedShutdown && !timedOut && !rpcFailureMessage && (code === null || code === 0)
              ? 0
              : code;

          resolve({
            exitCode,
            stdout,
            stderr,
            timedOut,
            signal,
            lastMessage: finalMessage,
            finalMessage,
            sessionId,
          });
        });

        void runRpcSession().catch((error) => {
          rpcFailureMessage = error instanceof Error ? error.message : String(error);
          child.kill('SIGTERM');
        });

        async function runRpcSession(): Promise<void> {
          await sendRequest('initialize', {
            protocolVersion: 2,
            capabilities: {},
            clientInfo: CLIENT_INFO,
          });
          await sendNotification('initialized', {});

          const threadMethod = request.mode === 'resume' ? 'thread/resume' : 'thread/start';
          const threadParams: Record<string, unknown> = {
            cwd: request.workspaceRoot,
            sandbox: request.sandboxMode,
          };

          if (request.model) {
            threadParams.model = request.model;
          }

          if (request.mode === 'resume') {
            if (!request.codexSessionId) {
              throw new Error('codexSessionId is required when mode is resume');
            }
            threadParams.threadId = request.codexSessionId;
          }

          const threadResult = (await sendRequest(threadMethod, threadParams)) as ThreadResponse;
          sessionId = threadResult.thread?.id ?? sessionId;

          if (!sessionId) {
            throw new Error(`${threadMethod} did not return a thread id`);
          }

          await setThreadName(sessionId, request.prompt);

          const turnResult = (await sendRequest('turn/start', {
            threadId: sessionId,
            cwd: request.workspaceRoot,
            input: [{ type: 'text', text: request.prompt }],
            ...(request.model ? { model: request.model } : {}),
          })) as { turn?: TurnRef };

          currentTurnId = turnResult.turn?.id;

          await waitForTurnCompletion();

          const threadReadResult = (await sendRequest('thread/read', {
            threadId: sessionId,
            includeTurns: true,
          })) as ThreadReadResponse;
          threadReadTurns = threadReadResult.thread?.turns ?? [];
          threadReadRaw = {
            jsonrpc: '2.0',
            id: nextRequestId - 1,
            result: threadReadResult,
          };

          requestShutdown();
        }

        function waitForTurnCompletion(): Promise<void> {
          return new Promise<void>((resolveTurn, rejectTurn) => {
            awaitTurnCompletion = {
              resolve: resolveTurn,
              reject: rejectTurn,
            };
          });
        }

        async function sendRequest(method: string, params: unknown): Promise<unknown> {
          const id = nextRequestId++;
          const payload = {
            jsonrpc: '2.0',
            id,
            method,
            params,
          };

          const responsePromise = new Promise<unknown>((resolveRequest, rejectRequest) => {
            pendingRequests.set(id, {
              resolve: resolveRequest,
              reject: rejectRequest,
            });
          });

          await writeMessage(payload);

          return await responsePromise;
        }

        async function sendNotification(method: string, params: unknown): Promise<void> {
          await writeMessage({
            jsonrpc: '2.0',
            method,
            params,
          });
        }

        async function writeMessage(message: unknown): Promise<void> {
          const line = `${JSON.stringify(message)}\n`;
          await new Promise<void>((resolveWrite, rejectWrite) => {
            if (!child.stdin) {
              rejectWrite(new Error('codex app-server stdin is unavailable'));
              return;
            }

            child.stdin.write(line, (error) => {
              if (error) {
                rejectWrite(error);
                return;
              }

              resolveWrite();
            });
          });
        }

        function drainStdout(): void {
          let newlineIndex = stdoutText.indexOf('\n');

          while (newlineIndex >= 0) {
            const line = stdoutText.slice(0, newlineIndex).trim();
            stdoutText = stdoutText.slice(newlineIndex + 1);

            if (line) {
              handleRpcLine(line);
            }

            newlineIndex = stdoutText.indexOf('\n');
          }
        }

        function requestShutdown(): void {
          if (requestedShutdown) {
            return;
          }

          requestedShutdown = true;

          const stdin = child.stdin as ClosableStdin | undefined | null;
          if (stdin && typeof stdin.end === 'function') {
            stdin.end();
          }

          shutdownTimer = setTimeout(() => {
            shutdownForced = true;
            child.kill('SIGTERM');
          }, 1_000);
        }

        function handleRpcLine(line: string): void {
          let parsed: JsonRpcSuccess | JsonRpcError | JsonRpcNotification;

          try {
            parsed = JSON.parse(line) as JsonRpcSuccess | JsonRpcError | JsonRpcNotification;
          } catch {
            return;
          }

          if (hasRpcId(parsed)) {
            const pending = pendingRequests.get(Number(parsed.id));
            if (!pending) {
              return;
            }

            pendingRequests.delete(Number(parsed.id));

            if (isJsonRpcError(parsed) && parsed.error) {
              rpcFailureMessage = formatRpcError(parsed);
              pending.reject(new Error(rpcFailureMessage));
              return;
            }

            pending.resolve(isJsonRpcSuccess(parsed) ? parsed.result : undefined);
            return;
          }

          if ('method' in parsed && typeof parsed.method === 'string') {
            handleNotification(parsed.method, parsed.params);
          }
        }

        function handleNotification(method: string, params: unknown): void {
          if (method === 'item.completed' || method === 'item/completed') {
            const item = (params as { item?: AgentMessageItem } | undefined)?.item;
            const text = extractMessageText(item);
            if (text) {
              notificationFinalMessage = text;
            }
            return;
          }

          if (method === 'turn.completed' || method === 'turn/completed') {
            const turn = (params as { turn?: TurnRef } | undefined)?.turn;
            if (turn?.status === 'failed') {
              awaitTurnCompletion?.reject(
                new Error(turn.error?.message ?? 'turn/start failed'),
              );
              awaitTurnCompletion = undefined;
              return;
            }

            awaitTurnCompletion?.resolve();
            awaitTurnCompletion = undefined;
          }
        }

        function rejectPending(error: Error): void {
          for (const pending of pendingRequests.values()) {
            pending.reject(error);
          }
          pendingRequests.clear();

          if (awaitTurnCompletion) {
            awaitTurnCompletion.reject(error);
            awaitTurnCompletion = undefined;
          }

          if (shutdownForced) {
            shutdownForced = false;
          }
        }

        async function setThreadName(threadId: string, name: string): Promise<void> {
          const methods = ['thread/name/set', 'thread/set-name'] as const;
          let lastUnsupportedError: unknown;

          for (const method of methods) {
            try {
              await sendRequest(method, {
                threadId,
                name,
              });
              return;
            } catch (error) {
              if (!isUnsupportedThreadSetNameError(error)) {
                throw error;
              }

              lastUnsupportedError = error;
            }
          }

          if (lastUnsupportedError) {
            return;
          }
        }
      });
    },
  };
}

export function isMissingNativeSessionError(stderr: string): boolean {
  const normalized = stderr.toLowerCase();
  return (
    (normalized.includes('thread/resume failed') && normalized.includes('no rollout found')) ||
    normalized.includes('no rollout found for thread id') ||
    normalized.includes('missing-session')
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
  platform = process.platform,
): { command: string; args: string[] } {
  const args = ['app-server', '--listen', 'stdio://'];

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

  return {
    command,
    args,
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

function extractMessageText(item: AgentMessageItem | undefined): string | undefined {
  if (item?.type !== 'agentMessage') {
    return undefined;
  }

  if (item.phase === 'final_answer' && typeof item.text === 'string' && item.text.trim()) {
    return item.text;
  }

  return undefined;
}

function extractFinalMessageFromTurns(
  turns: ThreadReadTurn[],
  turnId?: string,
): string | undefined {
  const targetTurn = turnId
    ? turns.find((candidate) => candidate.id === turnId) ?? turns.at(-1)
    : turns.at(-1);

  if (!targetTurn?.items?.length) {
    return undefined;
  }

  let fallback: string | undefined;

  for (const item of targetTurn.items) {
    if (item.type !== 'agentMessage' || typeof item.text !== 'string' || !item.text.trim()) {
      continue;
    }

    if (item.phase === 'final_answer') {
      return item.text;
    }

    fallback = item.text;
  }

  return fallback;
}

function extractFinalMessageFromStdout(stdout: string, turnId?: string): string | undefined {
  const turns: ThreadReadTurn[] = [];

  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        result?: ThreadReadResponse | ThreadResponse;
        method?: string;
        params?: { item?: AgentMessageItem };
      };

      if (parsed.method === 'item.completed' || parsed.method === 'item/completed') {
        const text = extractMessageText(parsed.params?.item);
        if (text) {
          return text;
        }
      }

      const candidateTurns = (parsed.result as ThreadReadResponse | undefined)?.thread?.turns;
      if (Array.isArray(candidateTurns)) {
        turns.push(...candidateTurns);
      }
    } catch {
      continue;
    }
  }

  return extractFinalMessageFromTurns(turns, turnId);
}

function extractSessionIdFromStdout(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        result?: ThreadResponse;
      };
      const candidate = parsed.result?.thread?.id;
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function extractRpcFailureMessageFromStdout(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        error?: {
          message?: string;
          code?: number;
        };
      };
      if (parsed.error?.message) {
        return parsed.error.code === undefined
          ? parsed.error.message
          : `${parsed.error.message} (code ${parsed.error.code})`;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function hasRpcId(message: JsonRpcSuccess | JsonRpcError | JsonRpcNotification): message is JsonRpcSuccess | JsonRpcError {
  return 'id' in message && (typeof message.id === 'number' || typeof message.id === 'string');
}

function isJsonRpcError(message: JsonRpcSuccess | JsonRpcError | JsonRpcNotification): message is JsonRpcError {
  return 'error' in message;
}

function isJsonRpcSuccess(message: JsonRpcSuccess | JsonRpcError | JsonRpcNotification): message is JsonRpcSuccess {
  return 'result' in message;
}

function formatRpcError(message: JsonRpcError): string {
  const errorMessage = message.error?.message ?? 'Unknown JSON-RPC error';
  return message.error?.code === undefined
    ? errorMessage
    : `${errorMessage} (code ${message.error.code})`;
}

function isUnsupportedThreadSetNameError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('unknown variant `thread/name/set`') ||
    normalized.includes('unknown method `thread/name/set`') ||
    normalized.includes('thread/name/set') ||
    normalized.includes('unknown variant `thread/set-name`') ||
    normalized.includes('unknown method `thread/set-name`') ||
    normalized.includes('thread/set-name')
  );
}
