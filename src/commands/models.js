import { loadRuntimeConfig, saveFileConfig } from '../core/config.js';
import { getModelsCachePath, listAvailableModels, loadModelsCache } from '../core/modelsRegistry.js';

export async function runModelsCommand(args) {
  const cwd = process.cwd();
  const config = await loadRuntimeConfig(cwd);
  const [action = 'list', ...rest] = args;

  if (action === 'use') {
    const model = (rest[0] || '').trim();
    if (!model) {
      throw new Error('Usage: ovopre models use <model-id>');
    }
    const next = await saveFileConfig({ model }, cwd);
    console.log(`model=${next.model}`);
    return;
  }

  if (action === 'where') {
    const cachePath = getModelsCachePath(cwd);
    const cache = await loadModelsCache(cwd);
    console.log(`cachePath=${cachePath}`);
    if (!cache) {
      console.log('cache=missing');
      return;
    }
    console.log(`baseURL=${cache.baseURL}`);
    console.log(`fetchedAt=${new Date(cache.fetchedAtMs).toISOString()}`);
    console.log(`count=${cache.models.length}`);
    return;
  }

  const refresh = action === 'refresh' || args.includes('--refresh');
  const json = args.includes('--json');
  const limit = parsePositiveInt(args.find((x) => x.startsWith('--limit='))?.slice('--limit='.length)) || 200;

  const result = await listAvailableModels({ config, cwd, refresh });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const at = Number.isFinite(result.fetchedAtMs) ? new Date(result.fetchedAtMs).toISOString() : 'unknown';
  console.log(`source=${result.source}`);
  console.log(`baseURL=${config.baseURL}`);
  console.log(`currentModel=${config.model}`);
  console.log(`fetchedAt=${at}`);
  console.log(`count=${result.models.length}`);
  if (result.warning) {
    console.log(`warning=${result.warning}`);
  }

  for (const item of result.models.slice(0, limit)) {
    const mark = item.id === config.model ? '*' : ' ';
    console.log(`${mark} ${item.id}`);
  }
}

function parsePositiveInt(raw) {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}
