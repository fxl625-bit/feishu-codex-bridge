import type { AppMetadata } from './types.js';
import type { AppConfig, RuntimeSummaryInput } from './types.js';

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
