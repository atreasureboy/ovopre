import {
  loadRuntimeConfig,
  loadFileConfig,
  redactConfig,
  getConfigPath,
  getSessionDir,
  getSkillsDir,
  getPluginsDir,
  getLogsDir
} from '../core/config.js';
import { listSessions } from '../core/sessionStore.js';
import { loadSkills } from '../skills/loader.js';
import { listPlugins } from '../plugins/loader.js';
import { listMcpTools } from '../mcp/runtime.js';
import { getMcpRuntimeStats } from '../mcp/runtime.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function runDoctorCommand() {
  const cwd = process.cwd();
  const config = await loadRuntimeConfig(cwd);
  const fileConfig = await loadFileConfig(cwd);
  const redacted = redactConfig(config);
  const sessions = await listSessions();
  const skills = await loadSkills(cwd);
  const plugins = await listPlugins(cwd);
  const mcpServers = Array.isArray(fileConfig.mcpServers) ? fileConfig.mcpServers.length : 0;
  const mcpTools = await safeCountMcpTools(cwd);
  const mcpRuntime = getMcpRuntimeStats();
  const taskLogs = await countTaskLogs();
  const commandModules = await countCommandModules(cwd);

  console.log('ovopre doctor');
  console.log(`node: ${process.version}`);
  console.log(`platform: ${process.platform}`);
  console.log(`cwd: ${process.cwd()}`);
  console.log(`configPath: ${getConfigPath()}`);
  console.log(`sessionDir: ${getSessionDir()}`);
  console.log(`skillsDir: ${getSkillsDir()}`);
  console.log(`pluginsDir: ${getPluginsDir()}`);
  console.log(`logsDir: ${getLogsDir()}`);
  console.log(`sessions: ${sessions.length}`);
  console.log(`skills: ${skills.length}`);
  console.log(`plugins: ${plugins.length}`);
  console.log(`mcpServers: ${mcpServers}`);
  console.log(`mcpTools: ${mcpTools}`);
  console.log(`mcpRuntimeSessions: ${mcpRuntime.pooledSessions}`);
  console.log(`mcpRuntimeCachedTools: ${mcpRuntime.cachedTools}`);
  console.log(`taskLogs: ${taskLogs}`);
  console.log(`commandModules: ${commandModules}`);
  console.log(`apiKey: ${config.apiKey ? 'set' : 'missing'}`);
  console.log(`apiKeySource: ${config._meta?.apiKeySource || 'unknown'}`);
  console.log(`baseURL: ${redacted.baseURL}`);
  console.log(`baseURLSource: ${config._meta?.baseURLSource || 'unknown'}`);
  console.log(`model: ${redacted.model}`);
  console.log(`modelSource: ${config._meta?.modelSource || 'unknown'}`);
  console.log(`temperature: ${redacted.temperature}`);
  console.log(`timeoutMs: ${redacted.timeoutMs}`);
  console.log(`maxRetries: ${redacted.maxRetries}`);
}

async function countTaskLogs() {
  const taskDir = path.join(getLogsDir(), 'tasks');
  try {
    const entries = await fs.readdir(taskDir, { withFileTypes: true });
    return entries.filter((x) => x.isFile() && x.name.endsWith('.jsonl')).length;
  } catch {
    return 0;
  }
}

async function safeCountMcpTools(cwd) {
  try {
    const tools = await listMcpTools(cwd);
    return tools.length;
  } catch {
    return 0;
  }
}

async function countCommandModules(cwd) {
  try {
    const dir = path.join(cwd, 'src', 'commands');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.js')).length;
  } catch {
    return 0;
  }
}
