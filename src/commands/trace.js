import fs from 'node:fs/promises';
import path from 'node:path';
import { getLogsDir } from '../core/config.js';

export async function runTraceCommand(args) {
  const [action = 'list', ...rest] = args;
  const tasksDir = path.join(getLogsDir(process.cwd()), 'tasks');
  await fs.mkdir(tasksDir, { recursive: true });

  if (action === 'list') {
    const entries = await fs.readdir(tasksDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name).sort().reverse();
    if (!files.length) {
      console.log('No task traces found.');
      return;
    }
    for (const f of files.slice(0, 30)) {
      console.log(f);
    }
    return;
  }

  if (action === 'show') {
    const id = rest[0];
    if (!id) {
      throw new Error('Usage: ovopre trace show <taskId|filename|latest>');
    }

    const file = await resolveTraceFile(tasksDir, id);
    if (!file) {
      throw new Error(`Trace not found: ${id}`);
    }
    const content = await fs.readFile(file, 'utf8');
    console.log(content.trim());
    return;
  }

  throw new Error(`Unknown trace action: ${action}`);
}

async function resolveTraceFile(tasksDir, id) {
  const entries = await fs.readdir(tasksDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name).sort().reverse();
  if (!files.length) {
    return null;
  }

  if (id === 'latest') {
    return path.join(tasksDir, files[0]);
  }

  if (id.endsWith('.jsonl')) {
    return path.join(tasksDir, id);
  }

  const exact = files.find((f) => f.includes(id));
  return exact ? path.join(tasksDir, exact) : null;
}
