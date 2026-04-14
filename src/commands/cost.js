import { loadTaskRecords, summarizeOverview, pricingFromEnv } from '../observability/analytics.js';

export async function runCostCommand(args) {
  const days = normalizeDays(args[0], 30);
  const pricing = pricingFromEnv();
  const records = await loadTaskRecords({ days, cwd: process.cwd() });
  const overview = summarizeOverview(records, pricing);

  console.log(
    JSON.stringify(
      {
        days,
        tasks: overview.tasks,
        tokens: overview.tokens,
        estimatedCostUSD: overview.estimatedCostUSD,
        pricing
      },
      null,
      2
    )
  );
}

function normalizeDays(raw, fallback) {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}
