import {
  loadTaskRecords,
  summarizeOverview,
  summarizeByField,
  summarizeTrend,
  buildFailureBoard,
  pricingFromEnv
} from '../observability/analytics.js';

export async function runReportCommand(args) {
  const days = normalizeDays(args[0], 7);
  const pricing = pricingFromEnv();
  const records = await loadTaskRecords({ days, cwd: process.cwd() });
  const overview = summarizeOverview(records, pricing);
  const byModel = summarizeByField(records, 'model', pricing).slice(0, 5);
  const byTaskType = summarizeByField(records, 'taskType', pricing).slice(0, 5);
  const failures = buildFailureBoard(records).slice(0, 8);
  const trend = summarizeTrend(records, pricing).slice(-7);

  console.log(`Ops Report (${days}d)`);
  console.log('Summary:');
  console.log(`  tasks=${overview.tasks.total} success=${overview.tasks.succeeded} failed=${overview.tasks.failed} rate=${overview.tasks.successRate}`);
  console.log(`  tokens=${overview.tokens.total} (prompt=${overview.tokens.prompt}, completion=${overview.tokens.completion})`);
  console.log(`  cost=${overview.estimatedCostUSD === null ? 'n/a' : `$${overview.estimatedCostUSD}`}`);

  console.log('Top Models:');
  for (const row of byModel) {
    console.log(`  ${row.key}: tasks=${row.tasks} rate=${row.successRate} cost=${row.estimatedCostUSD ?? 'n/a'}`);
  }

  console.log('Task Types:');
  for (const row of byTaskType) {
    console.log(`  ${row.key}: tasks=${row.tasks} rate=${row.successRate}`);
  }

  console.log('Failure Board:');
  if (!failures.length) {
    console.log('  none');
  } else {
    for (const row of failures) {
      console.log(`  ${row.category}: ${row.count}`);
    }
  }

  console.log('Trend:');
  if (!trend.length) {
    console.log('  no data');
  } else {
    for (const row of trend) {
      console.log(`  ${row.date}: tasks=${row.tasks} successRate=${row.successRate} tokens=${row.tokens.total} cost=${row.estimatedCostUSD ?? 'n/a'}`);
    }
  }
}

function normalizeDays(raw, fallback) {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}
