import type { BridgeInboundMessage, BridgeReply } from './bridge.js';
import { CommandParseError, getCommandHelpText, parseCommand } from './commands.js';
import type { ConversationStore } from './conversation-store.js';
import { writeConversationTranscript } from './conversation-export.js';
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
  'codexWorkspaceRoot' | 'codexTimeoutMs' | 'codexModel' | 'codexApprovalPolicy' | 'codexSandboxMode'
>;

type TaskRuntimeRunner = {
  run(request: CodexRunRequest): Promise<CodexRunResult>;
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
  runtimePaths: Pick<RuntimePaths, 'conversationsDir' | 'archiveSyncDir' | 'runDir'>;
  runner: TaskRuntimeRunner;
  sendReply: (reply: BridgeReply) => Promise<void>;
  onError?: (
    error: unknown,
    context: { phase: 'parse' | 'queue' | 'status'; message: BridgeInboundMessage },
  ) => void;
}

export function createTaskRuntime(deps: TaskRuntimeDependencies) {
  let queue = Promise.resolve();

  function schedule(operation: () => Promise<void>): Promise<void> {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
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
    void schedule(async () => {
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
      const result = await deps.runner.run({
        kind: task.kind,
        prompt: task.prompt,
        workspaceRoot: deps.config.codexWorkspaceRoot,
        tempDir: deps.runtimePaths.runDir,
        timeoutMs: deps.config.codexTimeoutMs,
        model: deps.config.codexModel,
        approvalPolicy: deps.config.codexApprovalPolicy,
        sandboxMode: deps.config.codexSandboxMode,
      });

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

  return {
    handleInboundMessage,
    continueSession,
    async idle() {
      await queue;
    },
  };
}
