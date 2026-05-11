import type { BridgeInboundMessage, BridgeReply } from './bridge.js';
import { ensureCodexSessionVisible } from './codex-session-visibility.js';
import { CommandParseError, getCommandHelpText, parseCommand } from './commands.js';
import type { ConversationStore } from './conversation-store.js';
import { writeConversationTranscript } from './conversation-export.js';
import { isMissingNativeSessionError, type NativeSessionRunResult } from './native-session-runner.js';
import type { NativeSessionStore } from './native-session-store.js';
import {
  formatCompletionMessage,
  formatHistoryMessage,
  formatSessionMessage,
  formatSessionsMessage,
  formatStatusMessage,
  summarizeCodexResult,
} from './formatter.js';
import type { CodexRunRequest, CodexRunResult } from './codex-runner.js';
import type { TaskRecord, TaskStore, TaskStatus } from './task-store.js';
import type { AppConfig, RuntimePaths } from './types.js';

type TaskRuntimeConfig = Pick<
  AppConfig,
  | 'codexWorkspaceRoot'
  | 'codexTimeoutMs'
  | 'codexModel'
  | 'codexApprovalPolicy'
  | 'codexSandboxMode'
  | 'nativeSessionIdleTimeoutMs'
>;

type OneShotRunner = {
  run(request: CodexRunRequest): Promise<CodexRunResult>;
};

type NativeTaskRuntimeRunner = {
  run(request: {
    mode: 'start' | 'resume';
    prompt: string;
    workspaceRoot: string;
    codexSessionId?: string;
    sandboxMode: AppConfig['codexSandboxMode'];
    timeoutMs?: number;
    tempDir?: string;
    model?: string;
  }): Promise<NativeSessionRunResult>;
};

interface QueueTaskInput {
  chatId: string;
  senderOpenId: string;
  kind: 'ask' | 'run';
  prompt: string;
  source: 'feishu' | 'pc';
  messageId?: string;
  sessionId?: string;
}

export interface TaskRuntimeDependencies {
  config: TaskRuntimeConfig;
  store: TaskStore;
  conversationStore: ConversationStore;
  nativeSessionStore: NativeSessionStore;
  runtimePaths: Pick<
    RuntimePaths,
    'conversationsDir' | 'archiveSyncDir' | 'runDir' | 'nativeSessionRegistryFile' | 'codexHomeDir'
  >;
  runner: OneShotRunner;
  nativeRunner: NativeTaskRuntimeRunner;
  sendReply: (reply: BridgeReply) => Promise<void>;
  onError?: (
    error: unknown,
    context: { phase: 'parse' | 'queue' | 'status'; message: BridgeInboundMessage },
  ) => void;
}

export function createTaskRuntime(deps: TaskRuntimeDependencies) {
  const queues = new Map<string, Promise<void>>();

  function schedule(chatId: string, operation: () => Promise<void>): Promise<void> {
    const queue = queues.get(chatId) ?? Promise.resolve();
    const next = queue.then(operation, operation);
    queues.set(chatId, next.catch(() => undefined));
    return next;
  }

  async function handleInboundMessage(message: BridgeInboundMessage): Promise<void> {
    let command;

    try {
      command = parseCommand(message.text);
    } catch (error) {
      if (error instanceof CommandParseError) {
        await deps.sendReply({
          chatId: message.chatId,
          text: getCommandHelpText(),
        });
        return;
      }

      deps.onError?.(error, { phase: 'parse', message });
      throw error;
    }

    switch (command.kind) {
      case 'help':
        await deps.sendReply({
          chatId: message.chatId,
          text: getCommandHelpText(),
        });
        return;
      case 'status': {
        const task = command.taskId
          ? await deps.store.get(command.taskId)
          : await deps.store.getLatestBySenderOpenId(message.senderOpenId);

        await deps.sendReply({
          chatId: message.chatId,
          text:
            task && task.senderOpenId === message.senderOpenId
              ? formatStatusMessage(task)
              : formatStatusMessage(undefined),
        });
        return;
      }
      case 'session': {
        const session = await deps.conversationStore.getByChatId(message.chatId);
        await deps.sendReply({
          chatId: message.chatId,
          text: formatSessionMessage(session),
        });
        return;
      }
      case 'sessions': {
        const sessions = await deps.conversationStore.list({
          participantOpenId: message.senderOpenId,
          limit: 5,
        });
        await deps.sendReply({
          chatId: message.chatId,
          text: formatSessionsMessage(sessions),
        });
        return;
      }
      case 'history': {
        const session = await deps.conversationStore.getByChatId(message.chatId);
        await deps.sendReply({
          chatId: message.chatId,
          text: formatHistoryMessage(session?.messages ?? [], command.count),
        });
        return;
      }
      case 'ask':
      case 'run':
        await queueTask({
          chatId: message.chatId,
          senderOpenId: message.senderOpenId,
          kind: command.kind,
          prompt: command.prompt,
          source: 'feishu',
          messageId: message.messageId,
        });
        return;
    }
  }

  async function continueSession(input: {
    sessionId: string;
    kind: 'ask' | 'run';
    prompt: string;
  }): Promise<void> {
    const session = await deps.conversationStore.getBySessionId(input.sessionId);
    if (!session) {
      throw new Error(`Unknown session ${input.sessionId}`);
    }

    await queueTask({
      chatId: session.chatId,
      senderOpenId: session.participants[0] ?? 'pc',
      kind: input.kind,
      prompt: input.prompt,
      source: 'pc',
      sessionId: session.sessionId,
    });
  }

  async function queueTask(input: QueueTaskInput): Promise<void> {
    void schedule(input.chatId, async () => {
      const inboundSession = await deps.conversationStore.appendMessage({
        chatId: input.chatId,
        participantOpenId: input.senderOpenId,
        direction: input.source === 'pc' ? 'local' : 'inbound',
        source: input.source,
        text: input.prompt,
        messageId: input.messageId,
      });
      await persistTranscript(inboundSession);

      const task = await deps.store.create({
        sessionId: input.sessionId ?? inboundSession.sessionId,
        chatId: input.chatId,
        senderOpenId: input.senderOpenId,
        kind: input.kind,
        prompt: input.prompt,
      });

      const queuedSession = await deps.conversationStore.appendMessage({
        chatId: input.chatId,
        direction: input.source === 'pc' ? 'local' : 'inbound',
        source: input.source,
        text: input.prompt,
        taskId: task.id,
        status: 'queued',
        messageId: input.messageId,
      });
      await persistTranscript(queuedSession);

      await executeTask(task);
    }).catch((error) => {
      deps.onError?.(error, {
        phase: 'queue',
        message: {
          chatId: input.chatId,
          messageId: input.messageId ?? '',
          senderOpenId: input.senderOpenId,
          text: input.prompt,
        },
      });
    });
  }

  async function executeTask(task: TaskRecord): Promise<void> {
    await deps.store.update(task.id, { status: 'running' });

    try {
      const result = await runViaNativeSession(task);

      const status: TaskStatus = result.exitCode === 0 && !result.timedOut ? 'completed' : 'failed';
      const summary = summarizeCodexResult({
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        lastMessage: result.lastMessage,
      });
      const updatedTask = await deps.store.update(task.id, {
        status,
        summary,
        result,
      });
      const replyText = formatCompletionMessage({
        id: task.id,
        status,
        summary,
        stdout: updatedTask?.result?.stdout,
        stderr: updatedTask?.result?.stderr,
      });

      const session = await deps.conversationStore.appendMessage({
        chatId: task.chatId,
        direction: 'outbound',
        source: 'codex',
        text: replyText,
        taskId: task.id,
        status,
      });
      await persistTranscript(session);

      await deps.sendReply({
        chatId: task.chatId,
        text: replyText,
      });
    } catch (error) {
      const summary = error instanceof Error ? error.message : 'Codex execution failed.';

      await deps.store.update(task.id, {
        status: 'failed',
        summary,
      });

      const replyText = formatCompletionMessage({
        id: task.id,
        status: 'failed',
        summary,
      });
      const session = await deps.conversationStore.appendMessage({
        chatId: task.chatId,
        direction: 'outbound',
        source: 'codex',
        text: replyText,
        taskId: task.id,
        status: 'failed',
      });
      await persistTranscript(session);

      await deps.sendReply({
        chatId: task.chatId,
        text: replyText,
      });
    }
  }

  async function persistTranscript(session: Awaited<ReturnType<ConversationStore['appendMessage']>>) {
    await writeConversationTranscript({
      session,
      conversationsDir: deps.runtimePaths.conversationsDir,
      archiveSyncDir: deps.runtimePaths.archiveSyncDir,
    });
  }

  async function runViaNativeSession(task: TaskRecord): Promise<NativeSessionRunResult> {
    const sandboxMode = task.kind === 'ask' ? 'read-only' : deps.config.codexSandboxMode;
    const binding = await deps.nativeSessionStore.getByChatId(task.chatId, task.kind);
    const now = new Date().toISOString();

    if (binding && binding.expiresAt > now) {
      const resumed = await deps.nativeRunner.run({
        mode: 'resume',
        codexSessionId: binding.codexSessionId,
        prompt: task.prompt,
        workspaceRoot: binding.workspaceRoot,
        sandboxMode,
        timeoutMs: deps.config.codexTimeoutMs,
        tempDir: deps.runtimePaths.runDir,
        model: deps.config.codexModel,
      });

      if (resumed.exitCode === 0 && !resumed.timedOut) {
        await deps.nativeSessionStore.touch(task.chatId, task.kind);
        return resumed;
      }

      if (!isMissingNativeSessionError(resumed.stderr)) {
        return resumed;
      }

      await deps.nativeSessionStore.delete(task.chatId, task.kind);
    } else if (binding) {
      await deps.nativeSessionStore.delete(task.chatId, task.kind);
    }

    const started = await deps.nativeRunner.run({
      mode: 'start',
      prompt: task.prompt,
      workspaceRoot: deps.config.codexWorkspaceRoot,
      sandboxMode,
      timeoutMs: deps.config.codexTimeoutMs,
      tempDir: deps.runtimePaths.runDir,
      model: deps.config.codexModel,
    });

    if (started.sessionId && started.exitCode === 0 && !started.timedOut) {
      await deps.nativeSessionStore.upsert({
        chatId: task.chatId,
        codexSessionId: started.sessionId,
        workerKind: task.kind,
        workspaceRoot: deps.config.codexWorkspaceRoot,
      });
      await ensureCodexSessionVisible({
        codexHomeDir: deps.runtimePaths.codexHomeDir,
        sessionId: started.sessionId,
        prompt: task.prompt,
        updatedAt: new Date().toISOString(),
      });
    }

    return started;
  }

  return {
    handleInboundMessage,
    continueSession,
    async idle() {
      await Promise.all([...queues.values()]);
    },
  };
}
