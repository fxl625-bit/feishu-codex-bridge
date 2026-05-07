import { CommandParseError, getCommandHelpText, parseCommand } from './commands.js';
import type { BridgeInboundMessage, BridgeReply } from './bridge.js';
import { formatCompletionMessage, formatQueuedMessage, formatStatusMessage, summarizeCodexResult } from './formatter.js';
import type { CodexRunRequest, CodexRunResult } from './codex-runner.js';
import type { TaskRecord, TaskStore } from './task-store.js';
import type { AppConfig } from './types.js';

type TaskRuntimeConfig = Pick<
  AppConfig,
  'codexWorkspaceRoot' | 'codexTimeoutMs' | 'codexModel' | 'codexApprovalPolicy' | 'codexSandboxMode'
>;

type TaskRuntimeRunner = {
  run(request: CodexRunRequest): Promise<CodexRunResult>;
};

export interface TaskRuntimeDependencies {
  config: TaskRuntimeConfig;
  store: TaskStore;
  runner: TaskRuntimeRunner;
  sendReply: (reply: BridgeReply) => Promise<void>;
  onError?: (error: unknown, context: { phase: 'parse' | 'queue' | 'status'; message: BridgeInboundMessage }) => void;
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
      case 'ask':
      case 'run': {
        const task = await deps.store.create({
          chatId: message.chatId,
          senderOpenId: message.senderOpenId,
          kind: command.kind,
          prompt: command.prompt,
        });

        await deps.sendReply({
          chatId: message.chatId,
          text: formatQueuedMessage(task),
        });

        void schedule(async () => {
          await executeTask(task);
        }).catch((error) => {
          deps.onError?.(error, { phase: 'queue', message });
        });

        return;
      }
    }
  }

  async function executeTask(task: TaskRecord): Promise<void> {
    await deps.store.update(task.id, { status: 'running' });

    try {
      const result = await deps.runner.run({
        kind: task.kind,
        prompt: task.prompt,
        workspaceRoot: deps.config.codexWorkspaceRoot,
        timeoutMs: deps.config.codexTimeoutMs,
        model: deps.config.codexModel,
        approvalPolicy: deps.config.codexApprovalPolicy,
        sandboxMode: deps.config.codexSandboxMode,
      });

      const status = result.exitCode === 0 && !result.timedOut ? 'completed' : 'failed';
      const summary = summarizeCodexResult(result);
      const updatedTask = await deps.store.update(task.id, {
        status,
        summary,
        result,
      });

      await deps.sendReply({
        chatId: task.chatId,
        text: formatCompletionMessage({
          id: task.id,
          status,
          summary,
          stdout: updatedTask?.result?.stdout,
          stderr: updatedTask?.result?.stderr,
        }),
      });
    } catch (error) {
      const summary = error instanceof Error ? error.message : 'Codex execution failed.';

      await deps.store.update(task.id, {
        status: 'failed',
        summary,
      });

      await deps.sendReply({
        chatId: task.chatId,
        text: formatCompletionMessage({
          id: task.id,
          status: 'failed',
          summary,
        }),
      });
    }
  }

  return {
    handleInboundMessage,
    async idle() {
      await queue;
    },
  };
}
