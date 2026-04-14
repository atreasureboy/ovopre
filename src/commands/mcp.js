import { loadFileConfig, saveFileConfig } from '../core/config.js';
import { listMcpTools, resetMcpRuntime, getMcpRuntimeStats, getMcpHealth } from '../mcp/runtime.js';

export async function runMcpCommand(args) {
  const [action = 'list', ...rest] = args;
  const cwd = process.cwd();
  const cfg = await loadFileConfig(cwd);
  const servers = Array.isArray(cfg.mcpServers) ? cfg.mcpServers : [];

  if (action === 'list') {
    if (!servers.length) {
      console.log('No MCP servers configured.');
      return;
    }
    for (const s of servers) {
      console.log(`${s.name}\t${s.command}\t${Array.isArray(s.args) ? s.args.join(' ') : ''}`);
    }
    return;
  }

  if (action === 'tools') {
    const tools = await listMcpTools(cwd);
    if (!tools.length) {
      console.log('No MCP tools discovered.');
      return;
    }
    for (const t of tools) {
      console.log(`${t.name}\\t${t.description}`);
    }
    return;
  }

  if (action === 'runtime') {
    const stats = getMcpRuntimeStats();
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  if (action === 'health') {
    const health = await getMcpHealth(cwd);
    if (!health.length) {
      console.log('No MCP servers configured.');
      return;
    }
    for (const h of health) {
      if (h.ok) {
        console.log(`${h.server}\\tok\\t${h.toolCount} tools\\t${h.latencyMs}ms`);
      } else {
        console.log(`${h.server}\\terror\\t${h.errorType || 'unknown'}\\t${h.latencyMs}ms\\t${h.error || ''}`);
      }
    }
    return;
  }

  if (action === 'reset') {
    await resetMcpRuntime();
    console.log('MCP runtime reset.');
    return;
  }

  if (action === 'add') {
    const name = rest[0];
    const command = rest[1];
    const argsList = rest.slice(2);
    if (!name || !command) {
      throw new Error('Usage: ovopre mcp add <name> <command> [args...]');
    }
    const next = [...servers.filter((s) => s.name !== name), { name, command, args: argsList }];
    await saveFileConfig({ mcpServers: next }, cwd);
    await resetMcpRuntime();
    console.log(`Added MCP server: ${name}`);
    return;
  }

  if (action === 'rm' || action === 'delete') {
    const name = rest[0];
    if (!name) {
      throw new Error('Usage: ovopre mcp rm <name>');
    }
    const next = servers.filter((s) => s.name !== name);
    await saveFileConfig({ mcpServers: next }, cwd);
    await resetMcpRuntime();
    console.log(`Removed MCP server: ${name}`);
    return;
  }

  throw new Error(`Unknown mcp action: ${action}`);
}
