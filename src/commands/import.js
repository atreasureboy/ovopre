import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureConfigDir, getConfigPath, getSessionDir, getSkillsDir, getPluginsDir } from '../core/config.js';

export async function runImportCommand(args) {
  const file = args[0];
  if (!file) throw new Error('Usage: ovopre import <export.json>');

  const cwd = process.cwd();
  await ensureConfigDir(cwd);

  const raw = await fs.readFile(file, 'utf8');
  const data = JSON.parse(raw);

  if (data.config) {
    await fs.writeFile(getConfigPath(cwd), JSON.stringify(data.config, null, 2) + '\n', 'utf8');
  }
  await writeDirJson(getSessionDir(cwd), data.sessions || {});
  await writeDirText(getSkillsDir(cwd), data.skills || {});
  await writeDirText(getPluginsDir(cwd), data.plugins || {});

  console.log(`Imported: ${file}`);
}

async function writeDirJson(dir, map) {
  await fs.mkdir(dir, { recursive: true });
  for (const [name, val] of Object.entries(map)) {
    await fs.writeFile(path.join(dir, name), JSON.stringify(val, null, 2) + '\n', 'utf8');
  }
}

async function writeDirText(dir, map) {
  await fs.mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(map)) {
    await fs.writeFile(path.join(dir, name), String(content || ''), 'utf8');
  }
}
