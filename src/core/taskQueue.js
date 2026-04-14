import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getLogsDir } from './config.js';

export async function enqueueBackgroundTask({ goal, cwd = process.cwd(), options = {} }) {
  const dir = await ensureQueueDir(cwd);
  const id = makeTaskId();
  const logPath = path.join(dir, `${id}.log`);
  const record = {
    id,
    goal,
    cwd,
    status: 'queued',
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    pid: null,
    exitCode: null,
    signal: null,
    error: null,
    logPath
  };
  await upsertTaskRecord(cwd, record);

  const cliEntry = resolveCliEntry();
  const opts = {
    cwd,
    model: options.model,
    temperature: options.temperature,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    maxTaskRetries: options.maxTaskRetries,
    verifyRounds: options.verifyRounds,
    maxToolRounds: options.maxToolRounds,
    autoRollbackOnFail: options.autoRollbackOnFail
  };
  const args = [
    cliEntry,
    'tasks-exec',
    id,
    encodeB64(goal),
    encodeB64(JSON.stringify(opts))
  ];

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const outFd = await fs.open(logPath, 'a');
  const child = spawn(process.execPath, args, {
    cwd,
    detached: true,
    stdio: ['ignore', outFd.fd, outFd.fd]
  });
  child.unref();
  await outFd.close();

  await updateTaskRecord(cwd, id, {
    status: 'running',
    startedAt: new Date().toISOString(),
    pid: child.pid || null
  });

  return await getTaskRecord(cwd, id);
}

export async function completeBackgroundTask(cwd, id, patch) {
  const nextPatch = {
    ...patch,
    finishedAt: patch.finishedAt || new Date().toISOString(),
    pid: null
  };
  await updateTaskRecord(cwd, id, nextPatch);
}

export async function listTaskRecords(cwd = process.cwd()) {
  const store = await loadQueueStore(cwd);
  await refreshExitedTasks(cwd, store.tasks);
  return [...store.tasks].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function showTaskRecord(cwd, id, tailLines = 120) {
  const task = await getTaskRecord(cwd, id);
  if (!task) {
    return null;
  }
  const log = await readTaskLog(task.logPath, tailLines);
  return { ...task, log };
}

export async function cancelBackgroundTask(cwd, id) {
  const task = await getTaskRecord(cwd, id);
  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }
  if (task.status !== 'running' || !task.pid) {
    return { ...task, canceled: false };
  }

  let killed = false;
  try {
    process.kill(task.pid, 'SIGTERM');
    killed = true;
  } catch {
    killed = false;
  }

  await updateTaskRecord(cwd, task.id, {
    status: 'canceled',
    finishedAt: new Date().toISOString(),
    signal: 'SIGTERM',
    pid: null
  });

  const next = await getTaskRecord(cwd, task.id);
  return { ...next, canceled: killed };
}

export async function getTaskRecord(cwd, idOrPrefix) {
  const store = await loadQueueStore(cwd);
  await refreshExitedTasks(cwd, store.tasks);
  const hit = resolveTask(store.tasks, idOrPrefix);
  return hit || null;
}

function resolveCliEntry() {
  const argv1 = process.argv[1] || '';
  if (!argv1) {
    throw new Error('Unable to resolve ovopre entrypoint');
  }
  return path.resolve(argv1);
}

async function refreshExitedTasks(cwd, tasks) {
  let changed = false;
  for (const task of tasks) {
    if (task.status !== 'running' || !task.pid) {
      continue;
    }
    const alive = isProcessAlive(task.pid);
    if (alive) {
      continue;
    }
    task.status = task.status === 'running' ? 'unknown' : task.status;
    task.finishedAt = task.finishedAt || new Date().toISOString();
    task.pid = null;
    changed = true;
  }
  if (changed) {
    await saveQueueStore(cwd, { tasks });
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveTask(tasks, idOrPrefix) {
  const key = String(idOrPrefix || '').trim();
  if (!key) {
    return null;
  }
  const exact = tasks.find((t) => t.id === key);
  if (exact) {
    return exact;
  }
  const pref = tasks.filter((t) => t.id.startsWith(key));
  if (pref.length === 1) {
    return pref[0];
  }
  if (pref.length > 1) {
    throw new Error(`Task prefix is ambiguous: ${key}`);
  }
  return null;
}

async function readTaskLog(logPath, tailLines) {
  try {
    const raw = await fs.readFile(logPath, 'utf8');
    const lines = raw.split('\n');
    return lines.slice(Math.max(0, lines.length - tailLines)).join('\n').trim();
  } catch {
    return '';
  }
}

async function updateTaskRecord(cwd, id, patch) {
  const store = await loadQueueStore(cwd);
  const idx = store.tasks.findIndex((t) => t.id === id);
  if (idx === -1) {
    throw new Error(`Task not found: ${id}`);
  }
  store.tasks[idx] = { ...store.tasks[idx], ...patch };
  await saveQueueStore(cwd, store);
}

async function upsertTaskRecord(cwd, record) {
  const store = await loadQueueStore(cwd);
  const idx = store.tasks.findIndex((t) => t.id === record.id);
  if (idx >= 0) {
    store.tasks[idx] = { ...store.tasks[idx], ...record };
  } else {
    store.tasks.push(record);
  }
  await saveQueueStore(cwd, store);
}

async function loadQueueStore(cwd) {
  const file = getQueueStorePath(cwd);
  await ensureQueueDir(cwd);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      return { tasks: [] };
    }
    return parsed;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { tasks: [] };
    }
    throw error;
  }
}

async function saveQueueStore(cwd, data) {
  const file = getQueueStorePath(cwd);
  await ensureQueueDir(cwd);
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function getQueueStorePath(cwd) {
  return path.join(getQueueDir(cwd), 'tasks.json');
}

function getQueueDir(cwd) {
  return path.join(getLogsDir(cwd), 'queue');
}

async function ensureQueueDir(cwd) {
  const dir = getQueueDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function makeTaskId() {
  const d = new Date();
  const stamp = [
    d.getUTCFullYear(),
    pad2(d.getUTCMonth() + 1),
    pad2(d.getUTCDate()),
    pad2(d.getUTCHours()),
    pad2(d.getUTCMinutes()),
    pad2(d.getUTCSeconds())
  ].join('');
  const rnd = Math.random().toString(36).slice(2, 8);
  return `t_${stamp}_${rnd}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function encodeB64(text) {
  return Buffer.from(String(text || ''), 'utf8').toString('base64url');
}
