import { readJsonFile, writeJsonFile } from './utils/fs.js';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';
export type TaskKind = 'ask' | 'run';

export interface TaskRecord {
  id: string;
  sessionId: string;
  chatId: string;
  senderOpenId: string;
  kind: TaskKind;
  prompt: string;
  status: TaskStatus;
  summary?: string;
  result?: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    signal?: NodeJS.Signals | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  sessionId: string;
  chatId: string;
  senderOpenId: string;
  kind: TaskKind;
  prompt: string;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  summary?: string;
  result?: TaskRecord['result'];
}

export interface TaskStore {
  create(input: CreateTaskInput): Promise<TaskRecord>;
  get(taskId: string): Promise<TaskRecord | undefined>;
  getLatestBySenderOpenId(senderOpenId: string): Promise<TaskRecord | undefined>;
  update(taskId: string, update: UpdateTaskInput): Promise<TaskRecord | undefined>;
}

interface TaskStoreState {
  tasks: TaskRecord[];
}

const EMPTY_STATE: TaskStoreState = { tasks: [] };

export function createTaskStore(options: { dataFile: string }): TaskStore {
  return {
    async create(input) {
      const state = await loadState(options.dataFile);
      const timestamp = nextTimestamp();
      const task: TaskRecord = {
        id: createTaskId(),
        sessionId: input.sessionId,
        chatId: input.chatId,
        senderOpenId: input.senderOpenId,
        kind: input.kind,
        prompt: input.prompt,
        status: 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      state.tasks.push(task);
      await saveState(options.dataFile, state);
      return task;
    },

    async get(taskId) {
      const state = await loadState(options.dataFile);
      return state.tasks.find((task) => task.id === taskId);
    },

    async getLatestBySenderOpenId(senderOpenId) {
      const state = await loadState(options.dataFile);
      const matches = state.tasks.filter((task) => task.senderOpenId === senderOpenId);
      return matches.at(-1);
    },

    async update(taskId, update) {
      const state = await loadState(options.dataFile);
      const index = state.tasks.findIndex((task) => task.id === taskId);

      if (index < 0) {
        return undefined;
      }

      const currentTask = state.tasks[index];
      const nextTask: TaskRecord = {
        ...currentTask,
        ...update,
        updatedAt: nextTimestamp(currentTask.updatedAt),
      };

      state.tasks[index] = nextTask;
      await saveState(options.dataFile, state);
      return nextTask;
    },
  };
}

async function loadState(dataFile: string): Promise<TaskStoreState> {
  const state = await readJsonFile<TaskStoreState>(dataFile, EMPTY_STATE);
  return {
    tasks: [...state.tasks],
  };
}

async function saveState(dataFile: string, state: TaskStoreState): Promise<void> {
  await writeJsonFile(dataFile, state);
}

function createTaskId(): string {
  return `task_${Math.random().toString(36).slice(2, 10)}`;
}

function nextTimestamp(previous?: string): string {
  const currentTime = Date.now();
  if (!previous) {
    return new Date(currentTime).toISOString();
  }

  const previousTime = Date.parse(previous);
  return new Date(Math.max(currentTime, previousTime + 1)).toISOString();
}
