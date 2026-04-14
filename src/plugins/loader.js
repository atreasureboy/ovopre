import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureConfigDir, getPluginsDir } from '../core/config.js';

let cache = { key: '', loadedAt: 0, plugins: [] };

export function resetPluginLoaderCache() {
  cache = { key: '', loadedAt: 0, plugins: [] };
}

export async function loadPlugins(baseCwd = process.cwd()) {
  await ensureConfigDir(baseCwd);
  const pluginsDir = getPluginsDir(baseCwd);
  const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && (e.name.endsWith('.js') || e.name.endsWith('.mjs')))
    .map((e) => path.join(pluginsDir, e.name))
    .sort();

  const key = `${pluginsDir}::${files.join('|')}`;
  const now = Date.now();
  if (cache.key === key && now - cache.loadedAt < 3000) {
    return cache.plugins;
  }

  const plugins = [];
  for (const file of files) {
    try {
      const mod = await import(`${pathToFileURL(file).href}?t=${now}`);
      const plugin = normalizePlugin(mod, file);
      if (plugin) {
        plugins.push(plugin);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      plugins.push({
        name: path.basename(file),
        tools: [],
        error: `Failed to load plugin: ${message}`
      });
    }
  }

  cache = { key, loadedAt: now, plugins };
  return plugins;
}

export async function getPluginToolDefinitions(baseCwd = process.cwd()) {
  const plugins = await loadPlugins(baseCwd);
  const defs = [];
  for (const plugin of plugins) {
    if (plugin.error) {
      continue;
    }
    for (const tool of plugin.tools || []) {
      defs.push(tool);
    }
  }
  return defs;
}

export async function callPluginTool(name, args, context = {}) {
  const plugins = await loadPlugins(context.cwd || process.cwd());
  for (const plugin of plugins) {
    if (plugin.error || typeof plugin.callTool !== 'function') {
      continue;
    }
    const hasTool = (plugin.tools || []).some((tool) => tool?.function?.name === name);
    if (!hasTool) {
      continue;
    }
    return await plugin.callTool(name, args, context);
  }
  return null;
}

export async function listPlugins(baseCwd = process.cwd()) {
  return loadPlugins(baseCwd);
}

function normalizePlugin(mod, file) {
  const plugin = mod.default || mod.plugin || mod;
  if (!plugin || typeof plugin !== 'object') {
    return null;
  }
  const name = String(plugin.name || path.basename(file));
  const tools = Array.isArray(plugin.tools) ? plugin.tools : [];
  const callTool = typeof plugin.callTool === 'function' ? plugin.callTool : null;
  return { name, tools, callTool, path: file };
}
