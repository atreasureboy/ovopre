import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { loadFileConfig } from './config.js';

const execAsync = promisify(exec);
const HOOK_TIMEOUT_MS = 10000;

// Cache hooks config per baseCwd to avoid re-reading on every tool call.
// Invalidated by invalidateHooksCache() or whenever the config key changes.
const _cache = new Map(); // baseCwd → { hooks, at }
const CACHE_TTL_MS = 30000;

export function invalidateHooksCache() {
  _cache.clear();
}

async function loadHooksConfig(baseCwd) {
  const entry = _cache.get(baseCwd);
  if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
    return entry.hooks;
  }
  const cfg = await loadFileConfig(baseCwd);
  const hooks = cfg.hooks || {};
  _cache.set(baseCwd, { hooks, at: Date.now() });
  return hooks;
}

/**
 * Run all configured preToolCall hooks for the given tool.
 * Returns { blocked: false } on success, or { blocked: true, reason } if any hook exits non-zero.
 * A blocked pre-hook prevents the tool call from executing.
 */
export async function runPreToolHooks(toolName, args, baseCwd = process.cwd()) {
  const hooksConfig = await loadHooksConfig(baseCwd);
  const hooks = normalizeHookList(hooksConfig.preToolCall);
  if (!hooks.length) return { blocked: false };

  const env = buildHookEnv(toolName, args, null);

  for (const hook of hooks) {
    const command = resolveHookCommand(hook);
    if (!command) continue;

    try {
      await execAsync(command, {
        cwd: baseCwd,
        env: { ...process.env, ...env },
        timeout: HOOK_TIMEOUT_MS
      });
    } catch (error) {
      // Non-zero exit → block the tool call and surface the reason
      const stderr = (error && typeof error === 'object' && 'stderr' in error)
        ? String(error.stderr || '')
        : '';
      const msg = stderr.trim() || (error instanceof Error ? error.message : String(error));
      return {
        blocked: true,
        reason: `preToolCall hook blocked "${toolName}": ${msg.slice(0, 500)}`
      };
    }
  }

  return { blocked: false };
}

/**
 * Run all configured postToolCall hooks after a tool call completes.
 * Fire-and-forget — errors are silently swallowed so they never break the agent loop.
 */
export function runPostToolHooks(toolName, result, baseCwd = process.cwd()) {
  // Intentionally not await — fire and forget
  loadHooksConfig(baseCwd)
    .then((hooksConfig) => {
      const hooks = normalizeHookList(hooksConfig.postToolCall);
      if (!hooks.length) return;

      const env = buildHookEnv(toolName, null, result);

      for (const hook of hooks) {
        const command = resolveHookCommand(hook);
        if (!command) continue;
        execAsync(command, {
          cwd: baseCwd,
          env: { ...process.env, ...env },
          timeout: HOOK_TIMEOUT_MS
        }).catch(() => {});
      }
    })
    .catch(() => {});
}

// ─── helpers ────────────────────────────────────────────────────────────────

function normalizeHookList(raw) {
  return Array.isArray(raw) ? raw.filter(Boolean) : [];
}

function resolveHookCommand(hook) {
  if (typeof hook === 'string') return hook.trim() || null;
  if (hook && typeof hook === 'object') return String(hook.command || '').trim() || null;
  return null;
}

function buildHookEnv(toolName, args, result) {
  return {
    OVOPRE_TOOL_NAME: String(toolName || ''),
    OVOPRE_TOOL_ARGS: args ? JSON.stringify(args) : '',
    OVOPRE_TOOL_OK: result !== null && result !== undefined ? (result.ok ? '1' : '0') : '',
    OVOPRE_TOOL_OUTPUT: result ? String(result.output || '').slice(0, 1000) : '',
    OVOPRE_TOOL_META: result?.meta ? JSON.stringify(result.meta) : ''
  };
}
