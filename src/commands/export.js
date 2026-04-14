import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigPath, getSessionDir, getSkillsDir, getPluginsDir } from '../core/config.js';

export async function runExportCommand(args) {
  const outFile = args[0] || path.join(process.cwd(), '.ovopre', 'export.json');
  const cwd = process.cwd();

  const payload = {
    exportedAt: new Date().toISOString(),
    config: await readJsonSafe(getConfigPath(cwd), {}),
    sessions: await readDirJson(getSessionDir(cwd)),
    skills: await readDirText(getSkillsDir(cwd)),
    plugins: await readDirText(getPluginsDir(cwd))
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Exported: ${outFile}`);
}

async function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readDirJson(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out = {};
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      const p = path.join(dir, e.name);
      out[e.name] = await readJsonSafe(p, null);
    }
    return out;
  } catch {
    return {};
  }
}

async function readDirText(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out = {};
    for (const e of entries) {
      if (!e.isFile()) continue;
      const p = path.join(dir, e.name);
      out[e.name] = await fs.readFile(p, 'utf8');
    }
    return out;
  } catch {
    return {};
  }
}
