import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_CONFIG = {
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  apiKey: '',
  temperature: 0.2,
  timeoutMs: 120000,
  maxRetries: 2
};

export function getConfigDir(baseCwd = process.cwd()) {
  const explicit = process.env.OVOPRE_HOME;
  if (explicit && explicit.trim()) {
    return path.resolve(explicit.trim());
  }
  return path.resolve(baseCwd, '.ovopre');
}

export function getConfigPath(baseCwd = process.cwd()) {
  return path.join(getConfigDir(baseCwd), 'config.json');
}

export function getSessionDir(baseCwd = process.cwd()) {
  return path.join(getConfigDir(baseCwd), 'sessions');
}

export function getSkillsDir(baseCwd = process.cwd()) {
  return path.join(getConfigDir(baseCwd), 'skills');
}

export function getPluginsDir(baseCwd = process.cwd()) {
  return path.join(getConfigDir(baseCwd), 'plugins');
}

export function getLogsDir(baseCwd = process.cwd()) {
  return path.join(getConfigDir(baseCwd), 'logs');
}

export async function ensureConfigDir(baseCwd = process.cwd()) {
  await fs.mkdir(getConfigDir(baseCwd), { recursive: true });
  await fs.mkdir(getSessionDir(baseCwd), { recursive: true });
  await fs.mkdir(getSkillsDir(baseCwd), { recursive: true });
  await fs.mkdir(getPluginsDir(baseCwd), { recursive: true });
  await fs.mkdir(getLogsDir(baseCwd), { recursive: true });
}

export async function loadFileConfig(baseCwd = process.cwd()) {
  const configPath = getConfigPath(baseCwd);
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export function resolveRuntimeConfig(fileConfig = {}) {
  const baseUrlFromEnv = firstNonEmpty(
    ['OPENAI_BASE_URL', 'OPENAI_API_BASE', 'OVOPRE_BASE_URL', 'OVOGO_BASE_URL'].map((k) => process.env[k])
  );
  const baseURL = baseUrlFromEnv || fileConfig.baseURL || DEFAULT_CONFIG.baseURL;
  const envModel = firstNonEmpty(
    ['OPENAI_MODEL', 'OVOPRE_MODEL', 'OVOGO_MODEL', 'OVOGO_DEFAULT_MODEL', 'DEEPSEEK_MODEL'].map(
      (k) => process.env[k]
    )
  );
  const fileModel = fileConfig.model;
  const inferredModel = inferDefaultModel(baseURL);
  let model = envModel || fileModel || inferredModel || DEFAULT_CONFIG.model;
  if (!envModel && (!fileModel || fileModel === DEFAULT_CONFIG.model) && inferredModel) {
    model = inferredModel;
  }
  const apiKeyFromEnv = firstNonEmpty(
    ['OPENAI_API_KEY', 'OVOPRE_API_KEY', 'OVOGO_API_KEY', 'DEEPSEEK_API_KEY'].map((k) => process.env[k])
  );
  const apiKey = apiKeyFromEnv || fileConfig.apiKey || DEFAULT_CONFIG.apiKey;

  const temperature =
    parseTemperature(
      firstNonEmpty(
        ['OPENAI_TEMPERATURE', 'OVOPRE_TEMPERATURE', 'OVOGO_TEMPERATURE', 'DEEPSEEK_MODEL_TEMPERATURE'].map(
          (k) => process.env[k]
        )
      )
    ) ??
    parseTemperature(fileConfig.temperature) ??
    DEFAULT_CONFIG.temperature;
  const timeoutMs =
    parsePositiveInt(firstNonEmpty(['OPENAI_TIMEOUT_MS', 'OVOPRE_TIMEOUT_MS', 'OVOGO_TIMEOUT_MS'].map((k) => process.env[k]))) ??
    parsePositiveInt(fileConfig.timeoutMs) ??
    DEFAULT_CONFIG.timeoutMs;
  const maxRetries =
    parseNonNegativeInt(
      firstNonEmpty(['OPENAI_MAX_RETRIES', 'OVOPRE_MAX_RETRIES', 'OVOGO_MAX_RETRIES'].map((k) => process.env[k]))
    ) ??
    parseNonNegativeInt(fileConfig.maxRetries) ??
    DEFAULT_CONFIG.maxRetries;

  return {
    baseURL,
    model,
    apiKey,
    temperature,
    timeoutMs,
    maxRetries,
    _meta: {
      baseURLSource: pickSource(baseUrlFromEnv, fileConfig.baseURL, DEFAULT_CONFIG.baseURL, 'env', 'file', 'default'),
      modelSource: pickSource(envModel, fileConfig.model, inferredModel || DEFAULT_CONFIG.model, 'env', 'file', 'inferred'),
      apiKeySource: pickSource(apiKeyFromEnv, fileConfig.apiKey, DEFAULT_CONFIG.apiKey, 'env', 'file', 'default')
    }
  };
}

export async function loadRuntimeConfig(baseCwd = process.cwd()) {
  const fileConfig = await loadFileConfig(baseCwd);
  return resolveRuntimeConfig(fileConfig);
}

export async function saveFileConfig(partial, baseCwd = process.cwd()) {
  await ensureConfigDir(baseCwd);
  const prev = await loadFileConfig(baseCwd);
  const normalizedPatch = { ...partial };

  if (normalizedPatch.temperature !== undefined) {
    const parsed = parseTemperature(normalizedPatch.temperature);
    if (parsed === undefined) {
      throw new Error('temperature must be a number between 0 and 2');
    }
    normalizedPatch.temperature = parsed;
  }
  if (normalizedPatch.timeoutMs !== undefined) {
    const parsed = parsePositiveInt(normalizedPatch.timeoutMs);
    if (parsed === undefined) {
      throw new Error('timeoutMs must be a positive integer');
    }
    normalizedPatch.timeoutMs = parsed;
  }
  if (normalizedPatch.maxRetries !== undefined) {
    const parsed = parseNonNegativeInt(normalizedPatch.maxRetries);
    if (parsed === undefined) {
      throw new Error('maxRetries must be a non-negative integer');
    }
    normalizedPatch.maxRetries = parsed;
  }

  const next = { ...DEFAULT_CONFIG, ...prev, ...normalizedPatch };
  await fs.writeFile(getConfigPath(baseCwd), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

export function redactConfig(config) {
  const redacted = { ...config };
  if (redacted.apiKey) {
    redacted.apiKey = `${redacted.apiKey.slice(0, 6)}...${redacted.apiKey.slice(-4)}`;
  }
  return redacted;
}

function parseTemperature(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 2) {
    return undefined;
  }
  return n;
}

function inferDefaultModel(baseURL) {
  const normalized = String(baseURL || '').toLowerCase();
  if (normalized.includes('api.deepseek.com')) {
    return 'deepseek-chat';
  }
  return undefined;
}

function parsePositiveInt(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return Math.floor(n);
}

function parseNonNegativeInt(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return undefined;
  }
  return Math.floor(n);
}

function firstNonEmpty(values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function pickSource(envValue, fileValue, fallbackValue, envLabel, fileLabel, fallbackLabel) {
  if (envValue !== undefined && envValue !== null && String(envValue).trim() !== '') {
    return envLabel;
  }
  if (fileValue !== undefined && fileValue !== null && String(fileValue).trim() !== '') {
    return fileLabel;
  }
  if (fallbackValue !== undefined && fallbackValue !== null && String(fallbackValue).trim() !== '') {
    return fallbackLabel;
  }
  return 'unknown';
}
