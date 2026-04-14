export async function runCommandsCommand() {
  const rows = [
    ['chat', 'interactive chat mode'],
    ['task', 'autonomous task runner'],
    ['config', 'runtime config management'],
    ['model', 'show/set model quickly'],
    ['tools', 'list available tools (builtin+plugin+mcp)'],
    ['status', 'quick runtime status'],
    ['files', 'list files with ripgrep'],
    ['diff', 'show git diff'],
    ['logs', 'list/show task logs'],
    ['export', 'export ovopre state snapshot'],
    ['import', 'import ovopre state snapshot'],
    ['probe', 'probe API/model connectivity'],
    ['models', 'list/cache/select remote models'],
    ['skills', 'manage local skills'],
    ['plugins', 'manage local plugins'],
    ['tasks', 'background task queue (list/show/cancel/run)'],
    ['mcp', 'manage mcp servers and runtime'],
    ['trace', 'view task traces'],
    ['stats', 'analytics dashboard and export'],
    ['cost', 'cost-only summary'],
    ['report', 'human-readable ops report'],
    ['session', 'session listing/show/delete'],
    ['doctor', 'environment diagnosis'],
    ['commands', 'list command catalog'],
    ['help', 'show help'],
    ['version', 'show version']
  ];

  for (const [name, desc] of rows) {
    console.log(`${name}\t${desc}`);
  }
}
