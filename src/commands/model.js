import { loadRuntimeConfig, saveFileConfig } from '../core/config.js';

export async function runModelCommand(args) {
  const [actionOrValue, ...rest] = args;
  const cwd = process.cwd();

  if (!actionOrValue || actionOrValue === 'show') {
    const cfg = await loadRuntimeConfig(cwd);
    console.log(cfg.model);
    return;
  }

  if (actionOrValue === 'set') {
    const model = (rest[0] || '').trim();
    if (!model) {
      throw new Error('Usage: ovopre model set <model>');
    }
    const next = await saveFileConfig({ model }, cwd);
    console.log(`model=${next.model}`);
    return;
  }

  const model = actionOrValue.trim();
  if (!model) {
    throw new Error('Usage: ovopre model [show|set <model>|<model>]');
  }
  const next = await saveFileConfig({ model }, cwd);
  console.log(`model=${next.model}`);
}
