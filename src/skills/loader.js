import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureConfigDir, getSkillsDir } from '../core/config.js';

export async function loadSkills(baseCwd = process.cwd()) {
  await ensureConfigDir(baseCwd);
  const dir = getSkillsDir(baseCwd);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith('.md') && !entry.name.endsWith('.txt')) {
      continue;
    }
    const filePath = path.join(dir, entry.name);
    const content = await fs.readFile(filePath, 'utf8');
    const text = content.trim();
    if (!text) {
      continue;
    }
    skills.push({
      name: entry.name,
      path: filePath,
      content: text
    });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export async function buildSkillsSystemAddendum(baseCwd = process.cwd()) {
  const skills = await loadSkills(baseCwd);
  if (!skills.length) {
    return '';
  }

  const blocks = skills.map((skill) => `## ${skill.name}\n${skill.content}`);
  return [
    'Additional local skills are active. Follow them when relevant:',
    ...blocks
  ].join('\n\n');
}
