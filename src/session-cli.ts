import { pathToFileURL } from 'node:url';
import * as Lark from '@larksuiteoapi/node-sdk';
import { loadConfig, resolveRuntimePaths } from './config.js';
import { createConversationStore, type ConversationStore } from './conversation-store.js';
import { createCodexRunner } from './codex-runner.js';
import { createNativeSessionRunner } from './native-session-runner.js';
import { createNativeSessionStore } from './native-session-store.js';
import { loadApplicationEnv } from './index.js';
import { createTaskRuntime } from './runtime.js';
import { createTaskStore, type TaskStore } from './task-store.js';

export interface SessionCliDependencies {
  runtime: {
    continueSession(input: { sessionId: string; kind: 'ask' | 'run'; prompt: string }): Promise<void>;
    idle(): Promise<void>;
  };
  store: TaskStore;
  conversationStore: ConversationStore;
  stdout: {
    write(value: string): void;
  };
}

export async function runSessionCli(
  args: string[],
  deps: SessionCliDependencies,
): Promise<void> {
  const [command, ...rest] = args;

  switch (command) {
    case 'list': {
      const sessions = await deps.conversationStore.list();
      deps.stdout.write(
        sessions.length === 0
          ? 'No sessions found.'
          : sessions.map((session) => session.sessionId).join('\n'),
      );
      return;
    }
    case 'show': {
      const sessionId = rest[0];
      if (!sessionId) {
        throw new Error('Usage: show <session-id>');
      }

      const session = await deps.conversationStore.getBySessionId(sessionId);
      if (!session) {
        throw new Error(`Unknown session ${sessionId}`);
      }

      deps.stdout.write(session.messages.map((message) => message.text).join('\n'));
      return;
    }
    case 'ask':
    case 'run': {
      const [sessionId, ...promptParts] = rest;
      const prompt = promptParts.join(' ').trim();
      if (!sessionId || !prompt) {
        throw new Error(`Usage: ${command} <session-id> <prompt>`);
      }

      await deps.runtime.continueSession({
        sessionId,
        kind: command,
        prompt,
      });
      await deps.runtime.idle();

      const session = await deps.conversationStore.getBySessionId(sessionId);
      deps.stdout.write(session?.messages.at(-1)?.text ?? '');
      return;
    }
    default:
      throw new Error('Usage: list | show <session-id> | ask <session-id> <prompt> | run <session-id> <prompt>');
  }
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command] = argv;
  const env = loadApplicationEnv(process.cwd(), process.env);
  const config = loadConfig(env);
  const runtimePaths = resolveRuntimePaths({
    env,
    localAppData: env.LOCALAPPDATA,
    port: config.port,
  });
  const store = createTaskStore({
    dataFile: runtimePaths.tasksFile,
  });
  const conversationStore = createConversationStore({
    dataFile: runtimePaths.conversationsFile,
  });
  const needsExecutionRuntime = command === 'ask' || command === 'run';
  const runtime = needsExecutionRuntime
    ? createTaskRuntime({
        config,
        store,
        conversationStore,
        nativeSessionStore: createNativeSessionStore({
          dataFile: runtimePaths.nativeSessionRegistryFile,
          idleTimeoutMs: config.nativeSessionIdleTimeoutMs,
        }),
        runtimePaths,
        runner: createCodexRunner(),
        nativeRunner: createNativeSessionRunner(),
        sendReply: async (reply) => {
          const client = new Lark.Client({
            appId: config.feishuAppId,
            appSecret: config.feishuAppSecret,
            domain: Lark.Domain.Feishu,
          });

          await client.im.v1.message.create({
            params: {
              receive_id_type: 'chat_id',
            },
            data: {
              receive_id: reply.chatId,
              content: JSON.stringify({ text: reply.text }),
              msg_type: 'text',
            },
          });
        },
      })
    : {
        async continueSession() {
          throw new Error('Execution runtime is not available for this command.');
        },
        async idle() {},
      };

  await runSessionCli(argv, {
    runtime,
    store,
    conversationStore,
    stdout: {
      write(value: string) {
        if (value) {
          console.log(value);
        }
      },
    },
  });
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
