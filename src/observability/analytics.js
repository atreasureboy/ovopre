import fs from 'node:fs/promises';
import path from 'node:path';
import { getLogsDir } from '../core/config.js';

export async function loadTaskRecords({ days = 30, cwd = process.cwd() } = {}) {
  const tasksDir = path.join(getLogsDir(cwd), 'tasks');
  await fs.mkdir(tasksDir, { recursive: true });
  const entries = await fs.readdir(tasksDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
    .map((e) => path.join(tasksDir, e.name));

  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const records = [];

  for (const file of files) {
    const record = await parseTaskTrace(file, since);
    if (record) {
      records.push(record);
    }
  }

  records.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  return records;
}

export function summarizeOverview(records, pricing = null) {
  const summary = {
    tasks: {
      total: records.length,
      succeeded: records.filter((r) => r.status === 'success').length,
      failed: records.filter((r) => r.status === 'failed').length,
      unknown: records.filter((r) => r.status === 'unknown').length
    },
    tokens: { prompt: 0, completion: 0, total: 0 },
    stageDurations: {},
    failureCategories: {},
    models: {},
    taskTypes: {}
  };

  for (const r of records) {
    summary.tokens.prompt += r.tokens.prompt;
    summary.tokens.completion += r.tokens.completion;
    summary.tokens.total += r.tokens.total;

    for (const [stage, stat] of Object.entries(r.stageDurations)) {
      const bucket = summary.stageDurations[stage] || { count: 0, totalMs: 0 };
      bucket.count += stat.count;
      bucket.totalMs += stat.totalMs;
      summary.stageDurations[stage] = bucket;
    }

    for (const [cat, c] of Object.entries(r.failureCategories)) {
      summary.failureCategories[cat] = (summary.failureCategories[cat] || 0) + c;
    }

    summary.models[r.model] = (summary.models[r.model] || 0) + 1;
    summary.taskTypes[r.taskType] = (summary.taskTypes[r.taskType] || 0) + 1;
  }

  const successRate = summary.tasks.total ? summary.tasks.succeeded / summary.tasks.total : 0;
  const estimatedCostUSD = estimateCost(summary.tokens, pricing);

  const stageAverages = {};
  for (const [stage, stat] of Object.entries(summary.stageDurations)) {
    stageAverages[stage] = {
      count: stat.count,
      avgMs: stat.count ? Math.round(stat.totalMs / stat.count) : 0,
      totalMs: stat.totalMs
    };
  }

  return {
    tasks: {
      ...summary.tasks,
      successRate: Number(successRate.toFixed(4))
    },
    tokens: summary.tokens,
    estimatedCostUSD,
    stageDurations: stageAverages,
    failureCategories: summary.failureCategories,
    models: summary.models,
    taskTypes: summary.taskTypes
  };
}

export function summarizeTrend(records, pricing = null) {
  const byDay = {};

  for (const r of records) {
    const day = String(r.startedAt || '').slice(0, 10);
    if (!day) {
      continue;
    }
    const bucket = byDay[day] || {
      date: day,
      tasks: 0,
      succeeded: 0,
      failed: 0,
      unknown: 0,
      tokens: { prompt: 0, completion: 0, total: 0 }
    };

    bucket.tasks += 1;
    if (r.status === 'success') bucket.succeeded += 1;
    else if (r.status === 'failed') bucket.failed += 1;
    else bucket.unknown += 1;

    bucket.tokens.prompt += r.tokens.prompt;
    bucket.tokens.completion += r.tokens.completion;
    bucket.tokens.total += r.tokens.total;

    byDay[day] = bucket;
  }

  const rows = Object.values(byDay).sort((a, b) => (a.date < b.date ? -1 : 1));
  return rows.map((row) => ({
    ...row,
    successRate: row.tasks ? Number((row.succeeded / row.tasks).toFixed(4)) : 0,
    estimatedCostUSD: estimateCost(row.tokens, pricing)
  }));
}

export function summarizeByField(records, field, pricing = null) {
  const out = {};
  for (const r of records) {
    const key = String(r[field] || 'unknown');
    const bucket = out[key] || {
      key,
      tasks: 0,
      succeeded: 0,
      failed: 0,
      tokens: { prompt: 0, completion: 0, total: 0 }
    };

    bucket.tasks += 1;
    if (r.status === 'success') bucket.succeeded += 1;
    if (r.status === 'failed') bucket.failed += 1;
    bucket.tokens.prompt += r.tokens.prompt;
    bucket.tokens.completion += r.tokens.completion;
    bucket.tokens.total += r.tokens.total;

    out[key] = bucket;
  }

  return Object.values(out)
    .map((x) => ({
      ...x,
      successRate: x.tasks ? Number((x.succeeded / x.tasks).toFixed(4)) : 0,
      estimatedCostUSD: estimateCost(x.tokens, pricing)
    }))
    .sort((a, b) => b.tasks - a.tasks);
}

export function buildFailureBoard(records) {
  const board = {};
  for (const r of records) {
    for (const [cat, count] of Object.entries(r.failureCategories)) {
      board[cat] = (board[cat] || 0) + count;
    }
  }
  return Object.entries(board)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

export function buildSessionCostReport(records, pricing = null) {
  return records.map((r) => ({
    taskId: r.taskId,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    status: r.status,
    model: r.model,
    taskType: r.taskType,
    promptTokens: r.tokens.prompt,
    completionTokens: r.tokens.completion,
    totalTokens: r.tokens.total,
    estimatedCostUSD: estimateCost(r.tokens, pricing),
    tracePath: r.tracePath
  }));
}

export function pricingFromEnv() {
  return {
    inputPer1M: parseRate(process.env.OVOPRE_PRICE_INPUT_PER_1M),
    outputPer1M: parseRate(process.env.OVOPRE_PRICE_OUTPUT_PER_1M)
  };
}

function estimateCost(tokens, pricing) {
  if (!pricing || pricing.inputPer1M === null || pricing.outputPer1M === null) {
    return null;
  }
  const value = (tokens.prompt / 1_000_000) * pricing.inputPer1M + (tokens.completion / 1_000_000) * pricing.outputPer1M;
  return Number(value.toFixed(6));
}

function parseRate(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function parseTaskTrace(file, sinceMs) {
  const raw = await fs.readFile(file, 'utf8');
  const lines = raw.split('\n').map((x) => x.trim()).filter(Boolean);
  if (!lines.length) {
    return null;
  }

  const record = {
    taskId: path.basename(file).replace(/\.jsonl$/, ''),
    tracePath: file,
    startedAt: null,
    finishedAt: null,
    status: 'unknown',
    model: 'unknown',
    taskType: 'task',
    tokens: { prompt: 0, completion: 0, total: 0 },
    stageDurations: {},
    failureCategories: {}
  };

  let hasSinceEvent = false;

  for (const line of lines) {
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = Date.parse(evt.ts || '');
    if (!Number.isFinite(ts)) {
      continue;
    }

    if (evt.type === 'task_start') {
      record.startedAt = evt.ts;
      if (evt.model) record.model = String(evt.model);
      if (evt.taskType) record.taskType = String(evt.taskType);
    }

    if (ts >= sinceMs) {
      hasSinceEvent = true;
    }

    if (evt.type === 'stage_complete' && evt.stage) {
      const stage = String(evt.stage);
      const duration = Number(evt.durationMs || 0);
      const bucket = record.stageDurations[stage] || { count: 0, totalMs: 0 };
      bucket.count += 1;
      bucket.totalMs += Number.isFinite(duration) ? duration : 0;
      record.stageDurations[stage] = bucket;

      addUsage(record.tokens, evt.usage);

      if (evt.failureCategory) {
        const cat = String(evt.failureCategory);
        record.failureCategories[cat] = (record.failureCategories[cat] || 0) + 1;
      }
    }

    if (evt.type === 'retry' && evt.failureCategory) {
      const cat = String(evt.failureCategory);
      record.failureCategories[cat] = (record.failureCategories[cat] || 0) + 1;
    }

    if (evt.type === 'task_complete') {
      record.finishedAt = evt.ts;
      record.status = evt.ok ? 'success' : 'failed';
    }
  }

  return hasSinceEvent ? record : null;
}

function addUsage(acc, usage) {
  if (!usage || typeof usage !== 'object') {
    return;
  }
  acc.prompt += Number(usage.prompt_tokens || 0);
  acc.completion += Number(usage.completion_tokens || 0);
  acc.total += Number(usage.total_tokens || 0);
}
