import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureConfigDir, getSkillsDir } from '../core/config.js';
import { loadSkills } from '../skills/loader.js';

export async function runSkillsCommand(args) {
  const [action = 'list', ...rest] = args;
  const cwd = process.cwd();

  if (action === 'list') {
    const skills = await loadSkills(cwd);
    if (!skills.length) {
      console.log('No skills found.');
      return;
    }
    for (const skill of skills) {
      console.log(`${skill.name}\t${skill.path}`);
    }
    return;
  }

  if (action === 'init-sample') {
    await ensureConfigDir(cwd);
    const name = rest[0] || 'coding-style.md';
    const filePath = path.join(getSkillsDir(cwd), name);
    const sample = [
      '# Coding Style Skill',
      '',
      '- Prefer minimal, focused edits.',
      '- Run lightweight verification before final response.',
      '- Report changed files and key commands executed.'
    ].join('\n');
    await fs.writeFile(filePath, sample + '\n', 'utf8');
    console.log(`Created sample skill: ${filePath}`);
    return;
  }

  throw new Error(`Unknown skills action: ${action}`);
}
