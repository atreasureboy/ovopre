import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureConfigDir, getPluginsDir } from '../core/config.js';
import { listPlugins, resetPluginLoaderCache } from '../plugins/loader.js';

export async function runPluginsCommand(args) {
  const [action = 'list', ...rest] = args;
  const cwd = process.cwd();
  const pluginsDir = getPluginsDir(cwd);

  if (action === 'list') {
    const plugins = await listPlugins(cwd);
    if (!plugins.length) {
      console.log('No plugins found.');
      return;
    }
    for (const p of plugins) {
      const status = p.error ? `error: ${p.error}` : `tools: ${(p.tools || []).length}`;
      console.log(`${p.name}\t${status}\t${p.path || ''}`);
    }
    return;
  }

  if (action === 'reload') {
    resetPluginLoaderCache();
    const plugins = await listPlugins(cwd);
    console.log(`reloaded plugins: ${plugins.length}`);
    return;
  }

  if (action === 'install') {
    const source = (rest[0] || '').trim();
    if (!source) {
      throw new Error('Usage: ovopre plugins install <sourceFile> [targetFileName]');
    }
    await ensureConfigDir(cwd);
    const srcPath = path.resolve(cwd, source);
    const srcStat = await fs.stat(srcPath);
    if (!srcStat.isFile()) {
      throw new Error(`Not a file: ${srcPath}`);
    }
    const targetName = normalizePluginFileName(rest[1] || path.basename(srcPath));
    const targetPath = path.join(pluginsDir, targetName);
    await fs.copyFile(srcPath, targetPath);
    await upsertPluginRegistry(cwd, targetName, srcPath);
    resetPluginLoaderCache();
    console.log(`Installed plugin: ${targetPath}`);
    return;
  }

  if (action === 'update') {
    const name = (rest[0] || '').trim();
    if (!name) {
      throw new Error('Usage: ovopre plugins update <nameOrFile> [sourceFile]');
    }
    await ensureConfigDir(cwd);
    const targetName = await resolveInstalledPluginFile(cwd, name);
    const targetPath = path.join(pluginsDir, targetName);
    const registry = await readPluginRegistry(cwd);
    const explicitSource = (rest[1] || '').trim();
    const source = explicitSource || registry.items?.[targetName]?.source || '';
    if (!source) {
      throw new Error('No source found. Provide source path: ovopre plugins update <name> <sourceFile>');
    }
    const srcPath = path.resolve(cwd, source);
    const srcStat = await fs.stat(srcPath);
    if (!srcStat.isFile()) {
      throw new Error(`Not a file: ${srcPath}`);
    }
    await fs.copyFile(srcPath, targetPath);
    await upsertPluginRegistry(cwd, targetName, srcPath);
    resetPluginLoaderCache();
    console.log(`Updated plugin: ${targetPath}`);
    return;
  }

  if (action === 'rm' || action === 'remove' || action === 'delete') {
    const name = (rest[0] || '').trim();
    if (!name) {
      throw new Error('Usage: ovopre plugins rm <nameOrFile>');
    }
    const targetName = await resolveInstalledPluginFile(cwd, name);
    const targetPath = path.join(pluginsDir, targetName);
    await fs.rm(targetPath, { force: true });
    await removePluginRegistryItem(cwd, targetName);
    resetPluginLoaderCache();
    console.log(`Removed plugin: ${targetPath}`);
    return;
  }

  if (action === 'init-sample') {
    await ensureConfigDir(cwd);
    const name = rest[0] || 'sample-plugin.mjs';
    const filePath = path.join(getPluginsDir(cwd), name);
    const source = [
      'export default {',
      "  name: 'sample-plugin',",
      '  tools: [',
      '    {',
      "      type: 'function',",
      '      function: {',
      "        name: 'sample_echo',",
      "        description: 'Echo text from plugin.',",
      '        parameters: {',
      "          type: 'object',",
      '          properties: { text: { type: \"string\" } },',
      "          required: ['text'],",
      '          additionalProperties: false',
      '        }',
      '      }',
      '    }',
      '  ],',
      '  async callTool(name, args) {',
      "    if (name !== 'sample_echo') return null;",
      "    return { ok: true, output: String(args.text || '') };",
      '  }',
      '};'
    ].join('\n');
    await fs.writeFile(filePath, source + '\n', 'utf8');
    console.log(`Created sample plugin: ${filePath}`);
    return;
  }

  throw new Error(`Unknown plugins action: ${action}`);
}

function normalizePluginFileName(name) {
  const base = String(name || '').trim();
  if (!base) {
    return 'plugin.mjs';
  }
  if (base.endsWith('.js') || base.endsWith('.mjs')) {
    return base;
  }
  return `${base}.mjs`;
}

async function resolveInstalledPluginFile(cwd, nameOrFile) {
  const plugins = await listPlugins(cwd);
  const byPath = plugins.find((p) => p.path && path.basename(p.path) === nameOrFile);
  if (byPath?.path) {
    return path.basename(byPath.path);
  }
  const byName = plugins.find((p) => p.name === nameOrFile);
  if (byName?.path) {
    return path.basename(byName.path);
  }
  const normalized = normalizePluginFileName(nameOrFile);
  const candidate = path.join(getPluginsDir(cwd), normalized);
  try {
    const stat = await fs.stat(candidate);
    if (stat.isFile()) {
      return normalized;
    }
  } catch {
    // ignore
  }
  throw new Error(`Plugin not found: ${nameOrFile}`);
}

async function readPluginRegistry(cwd) {
  const file = getPluginRegistryPath(cwd);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { items: {} };
    }
    return { items: parsed.items || {} };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { items: {} };
    }
    throw error;
  }
}

async function writePluginRegistry(cwd, data) {
  const file = getPluginRegistryPath(cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function getPluginRegistryPath(cwd) {
  return path.join(getPluginsDir(cwd), '.registry.json');
}

async function upsertPluginRegistry(cwd, fileName, sourcePath) {
  const prev = await readPluginRegistry(cwd);
  prev.items[fileName] = {
    source: sourcePath,
    updatedAt: new Date().toISOString()
  };
  await writePluginRegistry(cwd, prev);
}

async function removePluginRegistryItem(cwd, fileName) {
  const prev = await readPluginRegistry(cwd);
  delete prev.items[fileName];
  await writePluginRegistry(cwd, prev);
}
