import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadTaskRecords,
  summarizeOverview,
  summarizeTrend,
  summarizeByField,
  buildFailureBoard,
  buildSessionCostReport,
  pricingFromEnv
} from '../observability/analytics.js';

export async function runStatsCommand(args) {
  const [subOrDays, ...rest] = args;
  const sub = normalizeSub(subOrDays);

  if (sub === 'overview') {
    const days = parseDays(subOrDays, rest[0], 30);
    const out = await buildOverviewOutput(days);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (sub === 'trend') {
    const days = parseDays(undefined, rest[0], 30);
    const out = await buildTrendOutput(days);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (sub === 'model') {
    const days = parseDays(undefined, rest[0], 30);
    const out = await buildByFieldOutput('model', days);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (sub === 'task-type') {
    const days = parseDays(undefined, rest[0], 30);
    const out = await buildByFieldOutput('taskType', days);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (sub === 'failure') {
    const days = parseDays(undefined, rest[0], 30);
    const out = await buildFailureOutput(days);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (sub === 'export') {
    await runExport(rest, subOrDays);
    return;
  }

  throw new Error('Usage: ovopre stats [days]|trend [days]|model [days]|task-type [days]|failure [days]|export [days] [json|csv] [out]');
}

async function buildOverviewOutput(days) {
  const pricing = pricingFromEnv();
  const records = await loadTaskRecords({ days, cwd: process.cwd() });
  return {
    mode: 'overview',
    days,
    ...summarizeOverview(records, pricing),
    pricing: {
      inputPer1M: pricing.inputPer1M,
      outputPer1M: pricing.outputPer1M,
      note:
        pricing.inputPer1M === null || pricing.outputPer1M === null
          ? 'Set OVOPRE_PRICE_INPUT_PER_1M and OVOPRE_PRICE_OUTPUT_PER_1M to enable cost estimate.'
          : 'Using env-based price estimate.'
    }
  };
}

async function buildTrendOutput(days) {
  const pricing = pricingFromEnv();
  const records = await loadTaskRecords({ days, cwd: process.cwd() });
  return {
    mode: 'trend',
    days,
    rows: summarizeTrend(records, pricing)
  };
}

async function buildByFieldOutput(field, days) {
  const pricing = pricingFromEnv();
  const records = await loadTaskRecords({ days, cwd: process.cwd() });
  return {
    mode: field,
    days,
    rows: summarizeByField(records, field, pricing)
  };
}

async function buildFailureOutput(days) {
  const records = await loadTaskRecords({ days, cwd: process.cwd() });
  return {
    mode: 'failure',
    days,
    rows: buildFailureBoard(records)
  };
}

async function runExport(args, subOrDays) {
  const days = parseDays(subOrDays, args[0], 30);
  const format = normalizeFormat(args[1] || 'json');
  const outPath = args[2] || defaultExportPath(format);
  const pricing = pricingFromEnv();
  const records = await loadTaskRecords({ days, cwd: process.cwd() });
  const rows = buildSessionCostReport(records, pricing);

  await fs.mkdir(path.dirname(outPath), { recursive: true });

  if (format === 'csv') {
    await fs.writeFile(outPath, toCsv(rows), 'utf8');
  } else {
    await fs.writeFile(outPath, JSON.stringify(rows, null, 2) + '\n', 'utf8');
  }

  console.log(JSON.stringify({ mode: 'export', days, format, out: outPath, rows: rows.length }, null, 2));
}

function normalizeSub(subOrDays) {
  if (!subOrDays) {
    return 'overview';
  }
  if (/^\d+$/.test(String(subOrDays))) {
    return 'overview';
  }
  return String(subOrDays);
}

function parseDays(subOrDays, raw, fallback) {
  const candidate = /^\d+$/.test(String(subOrDays || '')) ? subOrDays : raw;
  if (!candidate) {
    return fallback;
  }
  const n = Number(candidate);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function defaultExportPath(format) {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(process.cwd(), '.ovopre', 'logs', `cost-report-${date}.${format}`);
}

function normalizeFormat(value) {
  const text = String(value || '').toLowerCase();
  return text === 'csv' ? 'csv' : 'json';
}

function toCsv(rows) {
  const header = [
    'taskId',
    'startedAt',
    'finishedAt',
    'status',
    'model',
    'taskType',
    'promptTokens',
    'completionTokens',
    'totalTokens',
    'estimatedCostUSD',
    'tracePath'
  ];

  const lines = [header.join(',')];
  for (const row of rows) {
    const values = header.map((k) => csvCell(row[k]));
    lines.push(values.join(','));
  }
  return lines.join('\n') + '\n';
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
