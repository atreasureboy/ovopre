import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exec, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { callPluginTool } from '../plugins/loader.js';
import { callMcpTool, listMcpResources, readMcpResource } from '../mcp/runtime.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Tools that are blocked in plan mode
const PLAN_MODE_BLOCKED = new Set(['bash', 'write_file', 'replace_in_file', 'replace_in_files', 'apply_patch']);

export async function executeToolCall(toolCall, options = {}) {
  const name = toolCall?.function?.name;
  const rawArgs = toolCall?.function?.arguments || '{}';

  let args;
  try {
    args = JSON.parse(rawArgs);
  } catch {
    return { ok: false, output: 'Invalid JSON arguments' };
  }

  // Plan mode guard: block write/execute tools
  if (options.toolContext?.planMode && PLAN_MODE_BLOCKED.has(name)) {
    return {
      ok: false,
      output: `"${name}" is blocked in plan mode. Call exit_plan_mode first to resume execution.`,
      meta: { blocked: 'plan_mode' }
    };
  }

  try {
    // ── Meta / control tools ──────────────────────────────────────────────
    if (name === 'tool_search') {
      return await toolSearchTool(args, options);
    }
    if (name === 'enter_plan_mode') {
      return enterPlanModeTool(options);
    }
    if (name === 'exit_plan_mode') {
      return exitPlanModeTool(args, options);
    }
    if (name === 'enter_worktree') {
      return await enterWorktreeTool(args, options);
    }
    if (name === 'exit_worktree') {
      return await exitWorktreeTool(args, options);
    }
    if (name === 'todo_write') {
      return todoWriteTool(args, options);
    }
    if (name === 'list_mcp_resources') {
      return await listMcpResourcesTool(args, options);
    }
    if (name === 'read_mcp_resource') {
      return await readMcpResourceTool(args, options);
    }

    // ── Dynamic / deferred tools (discovered via tool_search) ─────────────
    const mcpResult = await callMcpTool(name, args, options.cwd || process.cwd());
    if (mcpResult) {
      return normalizeToolResult(mcpResult);
    }

    const pluginResult = await callPluginTool(name, args, options);
    if (pluginResult) {
      return normalizeToolResult(pluginResult);
    }

    if (name === 'list_files') {
      return await listFilesTool(args, options);
    }
    if (name === 'grep_files') {
      return await grepFilesTool(args, options);
    }
    if (name === 'read_file') {
      return await readFileTool(args, options);
    }
    if (name === 'write_file') {
      return await writeFileTool(args, options);
    }
    if (name === 'replace_in_file') {
      return await replaceInFileTool(args, options);
    }
    if (name === 'replace_in_files') {
      return await replaceInFilesTool(args, options);
    }
    if (name === 'apply_patch') {
      return await applyPatchTool(args, options);
    }
    if (name === 'git_diff') {
      return await gitDiffTool(args, options);
    }
    if (name === 'code_index') {
      return await codeIndexTool(args, options);
    }
    if (name === 'bash') {
      return await bashTool(args, options);
    }

    return { ok: false, output: `Unknown tool: ${name}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message };
  }
}

async function listFilesTool(args, options) {
  const base = resolvePath(args.path || '.', options.cwd);
  const maxLines = Math.max(1, Number(args.maxLines || 400));

  try {
    const { stdout } = await execFileAsync('rg', ['--files', base], {
      cwd: options.cwd || process.cwd(),
      maxBuffer: 1024 * 1024
    });
    const lines = stdout
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, maxLines);

    return {
      ok: true,
      output: lines.join('\n') || '(no files)',
      meta: { count: lines.length, truncated: stdout.split('\n').filter(Boolean).length > lines.length }
    };
  } catch {
    const files = await walkFiles(base, maxLines);
    return { ok: true, output: files.join('\n') || '(no files)', meta: { count: files.length, fallback: 'walk' } };
  }
}

async function grepFilesTool(args, options) {
  const pattern = String(args.pattern || '').trim();
  if (!pattern) {
    return { ok: false, output: 'pattern is required' };
  }

  const base = resolvePath(args.path || '.', options.cwd);
  const maxLines = Math.max(1, Number(args.maxLines || 200));

  try {
    const { stdout } = await execFileAsync('rg', ['-n', '--no-heading', pattern, base], {
      cwd: options.cwd || process.cwd(),
      maxBuffer: 1024 * 1024
    });
    const lines = stdout
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);

    return {
      ok: true,
      output: lines.slice(0, maxLines).join('\n') || '(no matches)',
      meta: { count: lines.length, truncated: lines.length > maxLines }
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 1) {
      return { ok: true, output: '(no matches)', meta: { count: 0 } };
    }
    throw error;
  }
}

async function readFileTool(args, options) {
  const target = resolvePath(args.path, options.cwd);
  const maxBytes = Math.max(1, Number(args.maxBytes || 50000));
  const content = await fs.readFile(target, 'utf8');
  return { ok: true, output: content.slice(0, maxBytes), meta: { path: target, truncated: content.length > maxBytes } };
}

async function writeFileTool(args, options) {
  const target = resolvePath(args.path, options.cwd);
  await trackMutation(target, options);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (args.append) {
    await fs.appendFile(target, args.content, 'utf8');
  } else {
    await fs.writeFile(target, args.content, 'utf8');
  }
  return { ok: true, output: `Wrote ${Buffer.byteLength(args.content, 'utf8')} bytes to ${target}` };
}

async function replaceInFileTool(args, options) {
  const target = resolvePath(args.path, options.cwd);
  await trackMutation(target, options);
  const search = String(args.search || '');
  const replace = String(args.replace || '');
  const replaceAll = Boolean(args.all);

  if (!search) {
    return { ok: false, output: 'search must not be empty' };
  }

  const content = await fs.readFile(target, 'utf8');
  const count = countMatches(content, search);
  if (count === 0) {
    return { ok: false, output: `No match found for search text in ${target}` };
  }

  const next = replaceAll ? content.split(search).join(replace) : content.replace(search, replace);
  await fs.writeFile(target, next, 'utf8');
  const replaced = replaceAll ? count : 1;
  return { ok: true, output: `Replaced ${replaced} occurrence(s) in ${target}` };
}

async function replaceInFilesTool(args, options) {
  const pattern = String(args.pattern || '').trim();
  const search = String(args.search || '');
  const replace = String(args.replace || '');
  const base = resolvePath(args.path || '.', options.cwd);
  const maxFiles = Math.max(1, Number(args.maxFiles || 30));

  if (!pattern || !search) {
    return { ok: false, output: 'pattern and search must not be empty' };
  }

  const candidateFiles = await filesFromRipgrep(pattern, base, options.cwd || process.cwd(), maxFiles);
  if (!candidateFiles.length) {
    return { ok: true, output: '(no files matched)', meta: { changed: 0 } };
  }

  const changed = [];
  for (const file of candidateFiles) {
    await trackMutation(file, options);
    const content = await fs.readFile(file, 'utf8');
    if (!content.includes(search)) {
      continue;
    }
    const next = content.split(search).join(replace);
    await fs.writeFile(file, next, 'utf8');
    changed.push(file);
  }

  return {
    ok: true,
    output: changed.length ? changed.join('\n') : '(no files changed)',
    meta: { changed: changed.length, scanned: candidateFiles.length }
  };
}

async function applyPatchTool(args, options) {
  const patch = String(args.patch || '');
  if (!patch.includes('*** Begin Patch') || !patch.includes('*** End Patch')) {
    return { ok: false, output: 'Invalid patch format: must include *** Begin Patch and *** End Patch.' };
  }

  const touched = parsePatchTouchedFiles(patch, options.cwd || process.cwd());
  for (const file of touched) {
    await trackMutation(file, options);
  }

  const cwd = options.cwd || process.cwd();
  const result = await runApplyPatch(patch, cwd);
  return {
    ok: result.code === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim() || '(no output)',
    meta: { code: result.code }
  };
}

async function bashTool(args, options) {
  const timeout = Math.max(1000, Number(args.timeoutMs || 120000));
  const cwd = options.cwd || process.cwd();

  try {
    const { stdout, stderr } = await execAsync(String(args.command || ''), {
      cwd,
      timeout,
      maxBuffer: 4 * 1024 * 1024
    });

    const text = [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)';
    return { ok: true, output: text.slice(0, 30000), meta: { timeoutMs: timeout } };
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout || '') : '';
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr || '') : '';
    const message = error instanceof Error ? error.message : String(error);
    const text = [stdout, stderr, message].filter(Boolean).join('\n').trim() || '(command failed)';
    return { ok: false, output: text.slice(0, 30000), meta: { timeoutMs: timeout } };
  }
}

async function gitDiffTool(args, options) {
  const cwd = options.cwd || process.cwd();
  const staged = Boolean(args.staged);
  const maybePath = args.path ? String(args.path).trim() : '';
  const diffArgs = ['diff'];
  if (staged) {
    diffArgs.push('--cached');
  }
  if (maybePath) {
    diffArgs.push('--', maybePath);
  }

  try {
    const { stdout, stderr } = await execFileAsync('git', diffArgs, { cwd, maxBuffer: 4 * 1024 * 1024 });
    const text = [stdout, stderr].filter(Boolean).join('\n').trim();
    return { ok: true, output: text || '(no diff)' };
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout || '') : '';
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr || '') : '';
    if (!stdout && !stderr) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
    return { ok: true, output: [stdout, stderr].filter(Boolean).join('\n').trim() || '(no diff)' };
  }
}

async function codeIndexTool(args, options) {
  const base = resolvePath(args.path || '.', options.cwd);
  const maxLines = Math.max(1, Number(args.maxLines || 400));
  const cwd = options.cwd || process.cwd();
  const pattern = '^(export\\s+)?(async\\s+)?(function|class|interface|type|const\\s+\\w+\\s*=\\s*\\()';

  try {
    const { stdout } = await execFileAsync('rg', ['-n', '--no-heading', pattern, base], {
      cwd,
      maxBuffer: 4 * 1024 * 1024
    });
    const lines = stdout.split('\n').map((x) => x.trim()).filter(Boolean);
    return {
      ok: true,
      output: lines.slice(0, maxLines).join('\n') || '(no symbols found)',
      meta: { count: lines.length, truncated: lines.length > maxLines }
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 1) {
      return { ok: true, output: '(no symbols found)', meta: { count: 0 } };
    }
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

function resolvePath(inputPath, cwd) {
  const raw = String(inputPath || '').trim();
  if (!raw) {
    throw new Error('path is required');
  }
  const base = cwd || process.cwd();
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(base, raw);
}

async function walkFiles(root, limit) {
  const out = [];
  async function visit(dir) {
    if (out.length >= limit) {
      return;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= limit) {
        return;
      }
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') {
          continue;
        }
        await visit(next);
      } else if (entry.isFile()) {
        out.push(next);
      }
    }
  }

  await visit(root);
  return out;
}

function countMatches(content, search) {
  return content.split(search).length - 1;
}

function runApplyPatch(patch, cwd) {
  return new Promise((resolve) => {
    const child = spawn('apply_patch', [], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      stderr += `\n${error instanceof Error ? error.message : String(error)}`;
      resolve({ code: 1, stdout, stderr });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    child.stdin.write(patch);
    if (!patch.endsWith('\n')) {
      child.stdin.write('\n');
    }
    child.stdin.end();
  });
}

async function filesFromRipgrep(pattern, base, cwd, maxFiles) {
  try {
    const { stdout } = await execFileAsync('rg', ['-l', '--no-heading', pattern, base], {
      cwd,
      maxBuffer: 4 * 1024 * 1024
    });
    return stdout
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, maxFiles);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 1) {
      return [];
    }
    throw error;
  }
}

function normalizeToolResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, output: 'Invalid plugin tool result' };
  }
  return {
    ok: Boolean(result.ok),
    output: String(result.output ?? ''),
    meta: result.meta || null
  };
}

async function trackMutation(filePath, options) {
  const store = options?.mutationStore;
  if (!store || store.has(filePath)) {
    return;
  }
  try {
    const content = await fs.readFile(filePath, 'utf8');
    store.set(filePath, { exists: true, content });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      store.set(filePath, { exists: false, content: '' });
      return;
    }
    throw error;
  }
}

// ─── New tool implementations ────────────────────────────────────────────────

/**
 * tool_search: keyword search over deferred (MCP + plugin) tool definitions.
 * Matching schemas are added to toolContext.dynamicTools so they appear
 * in the next LLM round.
 */
async function toolSearchTool(args, options) {
  const query = String(args.query || '').toLowerCase().trim();
  if (!query) return { ok: false, output: 'query must not be empty' };

  const limit = Math.min(10, Math.max(1, Number(args.limit || 5)));
  const deferred = options.toolContext?.deferredDefinitions || [];

  const matches = deferred
    .filter((def) => {
      const n = (def?.function?.name || '').toLowerCase();
      const d = (def?.function?.description || '').toLowerCase();
      return n.includes(query) || d.includes(query);
    })
    .slice(0, limit);

  // Register matches into the dynamic tool map (agentLoop reads this each round)
  const dynamicTools = options.toolContext?.dynamicTools;
  if (dynamicTools) {
    for (const def of matches) {
      dynamicTools.set(def.function.name, def);
    }
  }

  if (!matches.length) {
    return {
      ok: true,
      output: `No deferred tools matched "${query}". Try a broader keyword.`,
      meta: { count: 0 }
    };
  }

  const lines = matches.map(
    (d) => `- ${d.function.name}: ${(d.function.description || '').slice(0, 100)}`
  );
  return {
    ok: true,
    output: `Found ${matches.length} tool(s) — now active in this session:\n${lines.join('\n')}`,
    meta: { count: matches.length, added: matches.map((d) => d.function.name) }
  };
}

/**
 * enter_plan_mode: flip the planMode flag in toolContext.
 */
function enterPlanModeTool(options) {
  if (options.toolContext) options.toolContext.planMode = true;
  return {
    ok: true,
    output:
      'Plan mode enabled. Write/execute tools (bash, write_file, replace_in_file, replace_in_files, apply_patch) are now blocked.\n' +
      'Use read-only tools to inspect the codebase and build your plan, then call exit_plan_mode.',
    meta: { planMode: true }
  };
}

/**
 * exit_plan_mode: unset planMode, optionally emit the plan summary.
 */
function exitPlanModeTool(args, options) {
  if (options.toolContext) options.toolContext.planMode = false;
  const summary = args.plan_summary ? `\n\nPlan:\n${args.plan_summary}` : '';
  return {
    ok: true,
    output: `Plan mode disabled. Execution tools are available again.${summary}`,
    meta: { planMode: false }
  };
}

/**
 * enter_worktree: create an isolated git worktree on a new branch.
 * All subsequent tool operations use the worktree path as cwd.
 */
async function enterWorktreeTool(args, options) {
  const cwd = options.cwd || process.cwd();

  // Verify this is a git repo
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd });
  } catch {
    return { ok: false, output: 'Not a git repository. enter_worktree requires git.' };
  }

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const branchName = args.branch || `ovopre-wt-${suffix}`;
  const wtPath = path.join(os.tmpdir(), `ovopre-wt-${suffix}`);

  try {
    await execFileAsync('git', ['worktree', 'add', '-b', branchName, wtPath], { cwd });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, output: `Failed to create worktree: ${msg}` };
  }

  if (options.toolContext) {
    options.toolContext.worktreePath = wtPath;
    options.toolContext.worktreeBranch = branchName;
    options.toolContext.worktreeOriginalCwd = cwd;
    options.toolContext.effectiveCwd = wtPath;
  }

  return {
    ok: true,
    output: [
      `Worktree created: ${wtPath}`,
      `Branch: ${branchName}`,
      'All file/bash tools now operate inside this worktree.',
      'Call exit_worktree when done.'
    ].join('\n'),
    meta: { path: wtPath, branch: branchName }
  };
}

/**
 * exit_worktree: merge or discard the current worktree.
 */
async function exitWorktreeTool(args, options) {
  const ctx = options.toolContext;
  const wtPath = ctx?.worktreePath;
  if (!wtPath) {
    return { ok: false, output: 'No active worktree found. Call enter_worktree first.' };
  }

  const action = args.action;
  const originalCwd = ctx.worktreeOriginalCwd || options.cwd || process.cwd();
  const branchName = ctx.worktreeBranch;
  let resultMsg = '';

  if (action === 'merge') {
    // Commit any uncommitted changes in the worktree before merging
    try {
      const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], { cwd: wtPath });
      if (statusOut.trim()) {
        await execFileAsync('git', ['add', '-A'], { cwd: wtPath });
        const commitMsg = args.commit_message || 'ovopre: worktree changes';
        await execFileAsync('git', ['commit', '-m', commitMsg], { cwd: wtPath });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, output: `Failed to commit worktree changes: ${msg}` };
    }

    // Merge branch into original
    try {
      const { stdout, stderr } = await execFileAsync(
        'git', ['merge', '--no-ff', branchName, '-m', `Merge worktree branch ${branchName}`],
        { cwd: originalCwd }
      );
      resultMsg = [stdout, stderr].filter(Boolean).join('\n').trim();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        output: `Merge failed. Worktree kept at ${wtPath} for inspection.\n${msg}`
      };
    }
  }

  // Remove the worktree
  try {
    await execFileAsync('git', ['worktree', 'remove', '--force', wtPath], { cwd: originalCwd });
  } catch { /* best effort */ }

  // Delete the temporary branch (discard only — merge keeps it for history)
  if (action === 'discard' && branchName) {
    await execFileAsync('git', ['branch', '-D', branchName], { cwd: originalCwd }).catch(() => {});
  }

  // Reset context
  if (ctx) {
    ctx.worktreePath = null;
    ctx.worktreeBranch = null;
    ctx.worktreeOriginalCwd = null;
    ctx.effectiveCwd = null;
  }

  const actionLabel = action === 'merge' ? 'merged and removed' : 'discarded';
  return {
    ok: true,
    output: [
      `Worktree ${actionLabel}: ${wtPath}`,
      resultMsg
    ].filter(Boolean).join('\n'),
    meta: { action, branch: branchName }
  };
}

/**
 * todo_write: replace the entire TODO list in toolContext.
 */
function todoWriteTool(args, options) {
  const todos = args.todos;
  if (!Array.isArray(todos)) {
    return { ok: false, output: 'todos must be an array' };
  }

  const VALID_STATUS = new Set(['pending', 'in_progress', 'completed']);
  const VALID_PRIORITY = new Set(['high', 'medium', 'low', undefined]);
  for (const t of todos) {
    if (!t.id || !t.content) {
      return { ok: false, output: 'Each todo must have id and content.' };
    }
    if (!VALID_STATUS.has(t.status)) {
      return { ok: false, output: `Invalid status "${t.status}". Must be: pending | in_progress | completed.` };
    }
    if (!VALID_PRIORITY.has(t.priority)) {
      return { ok: false, output: `Invalid priority "${t.priority}". Must be: high | medium | low.` };
    }
  }

  if (options.toolContext) options.toolContext.todos = todos;

  const STATUS_ICON = { pending: '○', in_progress: '◑', completed: '●' };
  const PRIORITY_TAG = { high: ' [!]', medium: '', low: ' [-]' };
  const lines = todos.map(
    (t) =>
      `${STATUS_ICON[t.status] || '?'} [${t.id}] ${t.content}${PRIORITY_TAG[t.priority] || ''}`
  );

  return {
    ok: true,
    output: `TODO list updated (${todos.length} items):\n${lines.join('\n')}`,
    meta: {
      count: todos.length,
      pending: todos.filter((t) => t.status === 'pending').length,
      in_progress: todos.filter((t) => t.status === 'in_progress').length,
      completed: todos.filter((t) => t.status === 'completed').length
    }
  };
}

/**
 * list_mcp_resources: list all resources from MCP servers.
 */
async function listMcpResourcesTool(args, options) {
  const baseCwd = options.cwd || process.cwd();
  const serverFilter = args.server ? String(args.server) : null;

  try {
    let resources = await listMcpResources(baseCwd);
    if (serverFilter) {
      resources = resources.filter((r) => r.serverName === serverFilter);
    }

    if (!resources.length) {
      return { ok: true, output: '(no MCP resources found)', meta: { count: 0 } };
    }

    const lines = resources.map(
      (r) => `[${r.serverName}] ${r.uri}${r.mimeType ? ` (${r.mimeType})` : ''}\n  ${r.name}: ${r.description}`
    );
    return {
      ok: true,
      output: lines.join('\n'),
      meta: { count: resources.length }
    };
  } catch (error) {
    return { ok: false, output: `Failed to list MCP resources: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * read_mcp_resource: read a resource from MCP servers by URI.
 */
async function readMcpResourceTool(args, options) {
  const uri = String(args.uri || '').trim();
  if (!uri) return { ok: false, output: 'uri is required' };

  const baseCwd = options.cwd || process.cwd();
  try {
    const result = await readMcpResource(uri, baseCwd);
    if (!result.ok) {
      return { ok: false, output: result.error || `Resource not found: ${uri}` };
    }

    const contents = result.contents;
    let text;
    if (typeof contents === 'string') {
      text = contents;
    } else if (Array.isArray(contents)) {
      text = contents
        .map((c) => (c?.type === 'text' ? c.text : JSON.stringify(c)))
        .join('\n');
    } else {
      text = JSON.stringify(contents, null, 2);
    }

    return {
      ok: true,
      output: text.slice(0, 50000),
      meta: { uri, serverName: result.serverName, truncated: text.length > 50000 }
    };
  } catch (error) {
    return { ok: false, output: `Failed to read MCP resource: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function parsePatchTouchedFiles(patch, cwd) {
  const files = new Set();
  const lines = String(patch || '').split('\n');
  for (const line of lines) {
    if (line.startsWith('*** Update File: ') || line.startsWith('*** Add File: ') || line.startsWith('*** Delete File: ')) {
      const raw = line.split(': ')[1]?.trim();
      if (!raw) {
        continue;
      }
      const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw);
      files.add(abs);
    }
  }
  return [...files];
}
