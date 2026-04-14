import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureConfigDir, getLogsDir } from '../core/config.js';

export async function createTaskTrace(goal, baseCwd = process.cwd(), meta = {}) {
  await ensureConfigDir(baseCwd);
  const taskId = `task_${new Date().toISOString().replace(/[:.]/g, '-')}_${Math.random().toString(36).slice(2, 8)}`;
  const traceDir = path.join(getLogsDir(baseCwd), 'tasks');
  await fs.mkdir(traceDir, { recursive: true });
  const tracePath = path.join(traceDir, `${taskId}.jsonl`);

  await appendTraceLine(tracePath, {
    ts: new Date().toISOString(),
    type: 'task_start',
    taskId,
    goal,
    ...meta
  });

  return {
    taskId,
    tracePath,
    async event(type, payload = {}) {
      await appendTraceLine(tracePath, {
        ts: new Date().toISOString(),
        type,
        ...payload
      });
    }
  };
}

async function appendTraceLine(file, obj) {
  await fs.appendFile(file, JSON.stringify(obj) + '\n', 'utf8');
}
