import { loadRuntimeConfig } from '../core/config.js';
import { listSessions } from '../core/sessionStore.js';
import { loadSkills } from '../skills/loader.js';
import { listPlugins } from '../plugins/loader.js';
import { listMcpServers, getMcpRuntimeStats } from '../mcp/runtime.js';

export async function runStatusCommand() {
  const cwd = process.cwd();
  const config = await loadRuntimeConfig(cwd);
  const sessions = await listSessions();
  const skills = await loadSkills(cwd);
  const plugins = await listPlugins(cwd);
  const mcpServers = await listMcpServers(cwd);
  const rt = getMcpRuntimeStats();

  console.log('ovopre status');
  console.log(`model=${config.model}`);
  console.log(`modelSource=${config._meta?.modelSource || 'unknown'}`);
  console.log(`baseURL=${config.baseURL}`);
  console.log(`baseURLSource=${config._meta?.baseURLSource || 'unknown'}`);
  console.log(`apiKey=${config.apiKey ? 'set' : 'missing'}`);
  console.log(`apiKeySource=${config._meta?.apiKeySource || 'unknown'}`);
  console.log(`sessions=${sessions.length}`);
  console.log(`skills=${skills.length}`);
  console.log(`plugins=${plugins.length}`);
  console.log(`mcpServers=${mcpServers.length}`);
  console.log(`mcpPooledSessions=${rt.pooledSessions}`);
}
