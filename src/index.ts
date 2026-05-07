import type { AppMetadata } from './types.js';
import type { AppConfig, RuntimeSummaryInput } from './types.js';
import { isAuthorizedUser } from './authz.js';
import { createBridge, type BridgeDependencies } from './bridge.js';
import { createFeishuService, type FeishuServiceDependencies } from './feishu.js';

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
