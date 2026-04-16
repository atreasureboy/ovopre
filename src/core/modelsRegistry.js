import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from './config.js';
import { fetchWithRetry, normalizeBaseURL } from './httpClient.js';

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export async function listAvailableModels({
  config,
  cwd = process.cwd(),
  refresh = false,
  ttlMs = DEFAULT_TTL_MS,
  timeoutMs,
  maxRetries
}) {
  const cache = await loadModelsCache(cwd);
  const now = Date.now();
  const cacheFresh =
    !!cache &&
    cache.baseURL === normalizeBaseURL(config.baseURL) &&
    Number.isFinite(cache.fetchedAtMs) &&
    now - cache.fetchedAtMs <= ttlMs;

  if (!refresh && cacheFresh) {
    return {
      source: 'cache',
      fetchedAtMs: cache.fetchedAtMs,
      models: cache.models
    };
  }

  try {
    const models = await fetchModelsFromRemote({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      timeoutMs: timeoutMs ?? config.timeoutMs ?? 120000,
      maxRetries: maxRetries ?? config.maxRetries ?? 2
    });
    const payload = {
      baseURL: normalizeBaseURL(config.baseURL),
      fetchedAtMs: now,
      models
    };
    await saveModelsCache(cwd, payload);
    return {
      source: 'remote',
      fetchedAtMs: now,
      models
    };
  } catch (error) {
    if (cache && cache.models?.length) {
      return {
        source: 'cache-stale',
        fetchedAtMs: cache.fetchedAtMs,
        models: cache.models,
        warning: error instanceof Error ? error.message : String(error)
      };
    }
    throw error;
  }
}

export async function loadModelsCache(cwd = process.cwd()) {
  const cachePath = getModelsCachePath(cwd);
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.models)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function getModelsCachePath(cwd = process.cwd()) {
  return path.join(getConfigDir(cwd), 'cache', 'models.json');
}

async function saveModelsCache(cwd, payload) {
  const cachePath = getModelsCachePath(cwd);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function fetchModelsFromRemote({ baseURL, apiKey, timeoutMs, maxRetries }) {
  if (!apiKey) {
    throw new Error('Missing API key. Set OPENAI_API_KEY or run: ovopre config init --api-key <key>');
  }
  const url = `${normalizeBaseURL(baseURL)}/models`;
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    timeoutMs,
    maxRetries
  });
  const payload = await response.json();
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data
    .map((x) => ({
      id: String(x?.id || '').trim(),
      ownedBy: String(x?.owned_by || ''),
      created: Number(x?.created || 0)
    }))
    .filter((x) => x.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}
