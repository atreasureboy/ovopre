import { getToolDefinitions } from '../tools/catalog.js';

export async function runToolsCommand() {
  const defs = await getToolDefinitions(process.cwd());
  for (const d of defs) {
    const name = d?.function?.name;
    if (!name) continue;
    console.log(`${name}\t${d?.function?.description || ''}`);
  }
}
