import * as http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as Lark from '@larksuiteoapi/node-sdk';
import { config as loadDotenv, parse as parseDotenv } from 'dotenv';
import { isAuthorizedUser } from './authz.js';
import { createBridge, type BridgeDependencies } from './bridge.js';
import { loadConfig, resolveRuntimePaths } from './config.js';
import { createConversationStore, type ConversationStore } from './conversation-store.js';
import { createCodexRunner } from './codex-runner.js';
import { createFeishuService, type FeishuServiceDependencies } from './feishu.js';
import { createNativeSessionRunner } from './native-session-runner.js';
import { createNativeSessionStore, type NativeSessionStore } from './native-session-store.js';
import { createTaskRuntime } from './runtime.js';
import { createTaskStore, type TaskStore } from './task-store.js';
import type { AppConfig, AppMetadata, RuntimePaths, RuntimeSummaryInput } from './types.js';

const APP_NAME = 'feishu-codex-bridge';
const APP_VERSION = '0.1.0';

export function createAppMetadata(): AppMetadata {
  return {
    name: APP_NAME,
    version: APP_VERSION,
  };
}

export function createRuntimeSummary(config: Pick<AppConfig, 'codexWorkspaceRoot'>): string;
export function createRuntimeSummary(input: RuntimeSummaryInput): string;
export function createRuntimeSummary(
  input: Pick<AppConfig, 'codexWorkspaceRoot'> | RuntimeSummaryInput,
): string {
  const workspaceRoot =
    'codexWorkspaceRoot' in input ? input.codexWorkspaceRoot : input.workspaceRoot;
  const transport = 'transport' in input ? input.transport : 'long-connection';

  return `transport=${transport}; workspace=${workspaceRoot}`;
}

export type BridgeRuntimeDependencies = {
  allowedOpenIds: readonly string[];
  transport: FeishuServiceDependencies['transport'];
  runTask: BridgeDependencies['runTask'];
  sendReply?: FeishuServiceDependencies['transport']['sendMessage'];
  onError?: (error: unknown) => void;
};

export function createBridgeRuntime(deps: BridgeRuntimeDependencies) {
  let handleBridgeMessage: FeishuServiceDependencies['onMessage'] = async () => {};

  const transport = {
    ...deps.transport,
    sendMessage: deps.sendReply ?? deps.transport.sendMessage,
  };

  const feishu = createFeishuService({
    transport,
    onMessage(message) {
      return handleBridgeMessage(message);
    },
    onError(error) {
      deps.onError?.(error);
    },
  });

  const bridge = createBridge({
    isAuthorized: (senderOpenId) => isAuthorizedUser(deps.allowedOpenIds, senderOpenId),
    sendReply: (reply) => feishu.reply(reply),
    runTask: deps.runTask,
    onError(error) {
      deps.onError?.(error);
    },
  });

  handleBridgeMessage = bridge.handleMessage;

  return {
    bridge,
    feishu,
  };
}

export interface BridgeApplicationDependencies {
  config: AppConfig;
  transport: FeishuServiceDependencies['transport'];
  store: TaskStore;
  conversationStore: ConversationStore;
  nativeSessionStore: NativeSessionStore;
  runtimePaths: RuntimePaths;
  runner?: ReturnType<typeof createCodexRunner>;
  nativeRunner?: ReturnType<typeof createNativeSessionRunner>;
  onError?: (error: unknown) => void;
}

export function createBridgeApplication(deps: BridgeApplicationDependencies) {
  const sendReply = async (reply: { chatId: string; text: string }) => {
    if (!deps.transport.sendMessage) {
      throw new Error('Feishu transport does not support replies');
    }

    await deps.transport.sendMessage(reply);
  };

  const runner = deps.runner ?? createCodexRunner();
  const nativeRunner = deps.nativeRunner ?? createNativeSessionRunner();
  const taskRuntime = createTaskRuntime({
    config: deps.config,
    store: deps.store,
    conversationStore: deps.conversationStore,
    nativeSessionStore: deps.nativeSessionStore,
    runtimePaths: deps.runtimePaths,
    runner,
    nativeRunner,
    sendReply,
    onError(error) {
      deps.onError?.(error);
    },
  });

  const { bridge, feishu } = createBridgeRuntime({
    allowedOpenIds: deps.config.allowedOpenIds,
    transport: deps.transport,
    runTask(message) {
      return taskRuntime.handleInboundMessage(message);
    },
    onError(error) {
      deps.onError?.(error);
    },
  });

  return {
    bridge,
    feishu,
    taskRuntime,
    async start() {
      await feishu.start();
    },
  };
}

export function loadEnvironmentFiles(cwd = process.cwd()): void {
  loadDotenv({
    path: path.join(cwd, '.env.local'),
    override: false,
  });
  loadDotenv({
    path: path.join(cwd, '.env'),
    override: false,
  });
}

export function loadApplicationEnv(
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const mergedEnv: Record<string, string | undefined> = { ...env };

  for (const fileName of ['.env', '.env.local']) {
    const filePath = path.join(cwd, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const parsed = parseDotenv(fs.readFileSync(filePath));
    for (const [key, value] of Object.entries(parsed)) {
      if (value.trim().length === 0) {
        continue;
      }

      mergedEnv[key] = value;
    }
  }

  return mergedEnv;
}

export function createLarkTransport(config: Pick<AppConfig, 'feishuAppId' | 'feishuAppSecret'>) {
  const client = new Lark.Client({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    domain: Lark.Domain.Feishu,
  });

  const wsClient = new Lark.WSClient({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    domain: Lark.Domain.Feishu,
    loggerLevel: Lark.LoggerLevel.info,
  });

  let onMessage = async (_message: unknown) => {};

  return {
    onMessage(handler: (message: unknown) => void | Promise<void>) {
      onMessage = async (message: unknown) => {
        await Promise.resolve(handler(message));
      };
    },
    async connect() {
      await Promise.resolve(
        wsClient.start({
          eventDispatcher: new Lark.EventDispatcher({}).register({
            'im.message.receive_v1': async (event: unknown) => {
              await onMessage({ event });
            },
          }),
        }),
      );
    },
    async sendMessage(message: { chatId: string; text: string }) {
      await client.im.v1.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: message.chatId,
          content: JSON.stringify({ text: message.text }),
          msg_type: 'text',
        },
      });
    },
  };
}

export function startHealthServer(port: number, summary: string) {
  const server = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true, summary }));
      return;
    }

    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(summary);
  });

  server.listen(port, '127.0.0.1');
  return server;
}

export async function startApplication(env: Record<string, string | undefined> = process.env) {
  loadEnvironmentFiles();
  const applicationEnv = loadApplicationEnv(process.cwd(), env);
  const config = loadConfig(applicationEnv);
  const runtimePaths = resolveRuntimePaths({
    env: applicationEnv,
    localAppData: applicationEnv.LOCALAPPDATA,
    port: config.port,
  });
  const transport = createLarkTransport(config);
  const store = createTaskStore({
    dataFile: runtimePaths.tasksFile,
  });
  const conversationStore = createConversationStore({
    dataFile: runtimePaths.conversationsFile,
  });
  const app = createBridgeApplication({
    config,
    transport,
    store,
    conversationStore,
    nativeSessionStore: createNativeSessionStore({
      dataFile: runtimePaths.nativeSessionRegistryFile,
      idleTimeoutMs: config.nativeSessionIdleTimeoutMs,
    }),
    runtimePaths,
    onError(error) {
      console.error('[bridge]', error);
    },
  });
  const summary = createRuntimeSummary(config);
  const healthServer = startHealthServer(config.port, summary);

  await app.start();

  return {
    ...app,
    config,
    summary,
    healthServer,
    runtimePaths,
  };
}

async function main() {
  const application = await startApplication(process.env);
  console.log(application.summary);
  console.log(`Health endpoint: ${application.runtimePaths.healthUrl}`);
  console.log(`Task store: ${application.runtimePaths.tasksFile}`);
  console.log(`Conversation store: ${application.runtimePaths.conversationsFile}`);
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
