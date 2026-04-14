import { TOOL_DEFINITIONS, CORE_TOOL_DEFINITIONS } from './definitions.js';
import { getPluginToolDefinitions } from '../plugins/loader.js';
import { getMcpToolDefinitions } from '../mcp/runtime.js';

/**
 * Core tools: always sent in every LLM request.
 * Includes all built-in tools + meta-tools (tool_search, plan mode, worktree, todo_write, mcp resources).
 */
export function getCoreToolDefinitions() {
  return [...CORE_TOOL_DEFINITIONS, ...TOOL_DEFINITIONS];
}

/**
 * Deferred tools: MCP tools + plugin tools.
 * NOT sent in the initial LLM request — the agent discovers them via tool_search.
 * When tool_search matches a deferred tool, its schema is added to the active tool list.
 */
export async function getDeferredToolDefinitions(baseCwd = process.cwd()) {
  const [pluginDefs, mcpDefs] = await Promise.all([
    getPluginToolDefinitions(baseCwd),
    getMcpToolDefinitions(baseCwd)
  ]);

  const coreName = new Set([
    ...CORE_TOOL_DEFINITIONS.map((d) => d?.function?.name),
    ...TOOL_DEFINITIONS.map((d) => d?.function?.name)
  ].filter(Boolean));

  const deferred = [];
  const seen = new Set(coreName);

  for (const def of [...pluginDefs, ...mcpDefs]) {
    const name = def?.function?.name;
    if (!name || seen.has(name)) continue;
    deferred.push(def);
    seen.add(name);
  }

  return deferred;
}

/**
 * Legacy: returns all tools at once (used by non-agentic paths like taskRunner).
 */
export async function getToolDefinitions(baseCwd = process.cwd()) {
  const core = getCoreToolDefinitions();
  const deferred = await getDeferredToolDefinitions(baseCwd);

  const seen = new Set(core.map((d) => d?.function?.name).filter(Boolean));
  const extras = deferred.filter((d) => {
    const n = d?.function?.name;
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });

  return [...core, ...extras];
}
