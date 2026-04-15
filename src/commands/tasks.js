import { loadRuntimeConfig } from '../core/config.js';
import { runTaskStateMachine } from '../core/taskRunner.js';
import {
  cancelBackgroundTask,
  completeBackgroundTask,
  enqueueBackgroundTask,
  listTaskRecords,
  showTaskRecord
} from '../core/taskQueue.js';

export async function runTasksCommand(args, options = {}) {
  const [action = 'list', ...rest] = args;
  const cwd = process.cwd();

  if (action === 'list') {
    const rows = await listTaskRecords(cwd);
    if (!rows.length) {
      console.log('No queued tasks.');
      return;
    }
    for (const t of rows) {
      console.log(`${t.id}\t${t.status}\t${t.createdAt}\tpid=${t.pid || '-'}\t${String(t.goal || '').slice(0, 80)}`);
    }
    return;
  }

  if (action === 'show') {
    const id = (rest[0] || '').trim();
    if (!id) {
      throw new Error('Usage: ovopre tasks show <taskId|prefix>');
    }
    const item = await showTaskRecord(cwd, id, 200);
    if (!item) {
      throw new Error(`Task not found: ${id}`);
    }
    console.log(JSON.stringify(item, null, 2));
    return;
  }

  if (action === 'cancel') {
    const id = (rest[0] || '').trim();
    if (!id) {
      throw new Error('Usage: ovopre tasks cancel <taskId|prefix>');
    }
    const result = await cancelBackgroundTask(cwd, id);
    console.log(`task=${result.id} status=${result.status} canceled=${result.canceled ? 'yes' : 'no'}`);
    return;
  }

  if (action === 'run' || action === 'start' || action === 'bg') {
    const goal = rest.join(' ').trim();
    if (!goal) {
      throw new Error('Usage: ovopre tasks run <goal>');
    }
    const queued = await enqueueBackgroundTask({
      goal,
      cwd,
      options
    });
    console.log(`queued task: ${queued.id}`);
    console.log(`status: ${queued.status}`);
    console.log(`log: ${queued.logPath}`);
    return;
  }

  throw new Error('Usage: ovopre tasks [list|show <id>|cancel <id>|run <goal>]');
}

export async function runTasksExecCommand(args) {
  const [id, goalB64, optsB64] = args;
  if (!id || !goalB64 || !optsB64) {
    throw new Error('Usage: ovopre tasks-exec <id> <goalB64> <optsB64>');
  }

  const goal = decodeB64(goalB64);
  const options = safeParseJson(decodeB64(optsB64)) || {};
  const cwd = options.cwd || process.cwd();
  const config = await loadRuntimeConfig(cwd);

  try {
    const result = await runTaskStateMachine({
      goal,
      config,
      options: {
        ...options,
        cwd,
        mode: 'task',
        enableTools: true,
        onProgress: (event) => {
          writeTaskProgressLog(event);
        }
      }
    });

    await completeBackgroundTask(cwd, id, {
      status: result.ok ? 'success' : 'failed',
      exitCode: result.ok ? 0 : 1
    });
    console.log(result.summary || '');
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await completeBackgroundTask(cwd, id, {
      status: 'failed',
      exitCode: 1,
      error: message
    });
    console.error(message);
    process.exit(1);
  }
}

function writeTaskProgressLog(event) {
  if (!event || !event.type) {
    return;
  }
  if (event.type === 'plan') {
    const text = String(event.text || '').trim();
    if (!text) {
      return;
    }
    console.log('[plan]');
    console.log(text);
    return;
  }
  if (event.type === 'attempt_start') {
    console.log(`[progress] attempt ${event.attempt}/${event.totalAttempts}`);
    return;
  }
  if (event.type === 'verify') {
    const failed = Array.isArray(event.failedCommands) ? event.failedCommands.filter(Boolean) : [];
    if (event.passed) {
      console.log(`[verify] passed in round ${event.rounds}`);
    } else {
      const suffix = failed.length ? ` failed: ${failed.join(' | ')}` : '';
      console.log(`[verify] failed (${event.failureCategory || 'unknown'})${suffix}`);
    }
    return;
  }
  if (event.type === 'retry') {
    const detail = String(event.failureDetail || '').split('\n')[0].slice(0, 140);
    const more = detail ? `, reason: ${detail}` : '';
    console.log(
      `[retry] ${event.attempt}/${event.totalAttempts}, next ${event.nextAttempt}/${event.totalAttempts}${more}`
    );
  }
}

function decodeB64(text) {
  return Buffer.from(String(text || ''), 'base64url').toString('utf8');
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
