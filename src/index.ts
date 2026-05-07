import * as http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as Lark from '@larksuiteoapi/node-sdk';
import { config as loadDotenv } from 'dotenv';
import { loadConfig } from './config.js';
import { createCodexRunner } from './codex-runner.js';
import { isAuthorizedUser } from './authz.js';
import { createBridge, type BridgeDependencies } from './bridge.js';
import { createFeishuService, type FeishuServiceDependencies } from './feishu.js';
import { createTaskRuntime } from './runtime.js';
import { createTaskStore, type TaskStore } from './task-store.js';
import type { AppConfig, AppMetadata, RuntimeSummaryInput } from './types.js';

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
  runner?: ReturnType<typeof createCodexRunner>;
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
  const taskRuntime = createTaskRuntime({
    config: deps.config,
    store: deps.store,
    runner,
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

  server.listen(port);
  return server;
}

export async function startApplication(env: Record<string, string | undefined> = process.env) {
  loadEnvironmentFiles();
  const config = loadConfig(env);
  const transport = createLarkTransport(config);
  const store = createTaskStore({
    dataFile: path.join(process.cwd(), 'data', 'tasks.json'),
  });
  const app = createBridgeApplication({
    config,
    transport,
    store,
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
  };
}

async function main() {
  const application = await startApplication(process.env);
  console.log(application.summary);
  console.log(`Health endpoint: http://127.0.0.1:${application.config.port}/health`);
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
