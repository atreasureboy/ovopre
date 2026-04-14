import fs from 'node:fs/promises';
import path from 'node:path';
import { getLogsDir } from '../core/config.js';

export async function runLogsCommand(args) {
  const [action = 'list', ref = 'latest'] = args;
  const cwd = process.cwd();
  const tasksDir = path.join(getLogsDir(cwd), 'tasks');
  await fs.mkdir(tasksDir, { recursive: true });

  if (action === 'list') {
    const entries = await fs.readdir(tasksDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name).sort().reverse();
    if (!files.length) {
      console.log('No logs found.');
      return;
    }
    for (const file of files.slice(0, 50)) console.log(file);
    return;
  }

  if (action === 'show') {
    const file = await resolveLogFile(tasksDir, ref);
    if (!file) throw new Error(`Log not found: ${ref}`);
    const content = await fs.readFile(file, 'utf8');
    console.log(content.trim());
    return;
  }

  throw new Error('Usage: ovopre logs [list|show <latest|taskId|file>]');
}

async function resolveLogFile(tasksDir, ref) {
  const entries = await fs.readdir(tasksDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name).sort().reverse();
  if (!files.length) return null;
  if (ref === 'latest') return path.join(tasksDir, files[0]);
  if (ref.endsWith('.jsonl')) return path.join(tasksDir, ref);
  const hit = files.find((f) => f.includes(ref));
  return hit ? path.join(tasksDir, hit) : null;
}
