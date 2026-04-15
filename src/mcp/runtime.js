import { spawn } from 'node:child_process';
import { loadFileConfig } from '../core/config.js';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const TOOLS_CACHE_TTL_MS = 15000;
const SESSION_IDLE_TTL_MS = 120000;
const HEARTBEAT_INTERVAL_MS = 30000;

let toolsCache = {
  key: '',
  at: 0,
  tools: []
};

const mcpToolRegistry = new Map();
const sessionPool = new Map();

process.on('exit', () => {
  for (const [, entry] of sessionPool) {
    entry.session.close().catch(() => {});
  }
  sessionPool.clear();
});

export async function listMcpServers(baseCwd = process.cwd()) {
  const cfg = await loadFileConfig(baseCwd);
  const servers = Array.isArray(cfg.mcpServers) ? cfg.mcpServers : [];
  return servers
    .filter((s) => s && s.name && s.command)
    .map((s) => ({
      name: String(s.name),
      command: String(s.command),
      args: Array.isArray(s.args) ? s.args.map(String) : []
    }));
}

export async function getMcpToolDefinitions(baseCwd = process.cwd()) {
  const servers = await listMcpServers(baseCwd);
  const cacheKey = JSON.stringify({ baseCwd, servers });
  const now = Date.now();
  if (toolsCache.key === cacheKey && now - toolsCache.at < TOOLS_CACHE_TTL_MS) {
    return toolsCache.tools;
  }

  reapIdleSessions();
  const allDefs = [];
  mcpToolRegistry.clear();

  for (const server of servers) {
    try {
      const listed = await withSession(server, baseCwd, async (session) => session.request('tools/list', {}));
      const tools = Array.isArray(listed?.tools) ? listed.tools : [];

      for (const tool of tools) {
        if (!tool?.name) {
          continue;
        }
        const fullName = toMcpToolName(server.name, String(tool.name));
        mcpToolRegistry.set(fullName, {
          serverName: server.name,
          toolName: String(tool.name)
        });
        allDefs.push({
          type: 'function',
          function: {
            name: fullName,
            description: `[MCP:${server.name}] ${tool.description || ''}`.trim(),
            parameters: normalizeInputSchema(tool.inputSchema)
          }
        });
      }
    } catch (error) {
      if (process.env.OVOPRE_DEBUG_MCP === '1') {
        const message = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error(`[mcp] failed to load tools from ${server.name}: ${message}`);
      }
    }
  }

  toolsCache = { key: cacheKey, at: now, tools: allDefs };
  return allDefs;
}

export async function callMcpTool(toolName, args, baseCwd = process.cwd()) {
  const parsed = mcpToolRegistry.get(String(toolName)) || parseMcpToolName(toolName);
  if (!parsed) {
    return null;
  }

  const servers = await listMcpServers(baseCwd);
  const server = servers.find((s) => s.name === parsed.serverName);
  if (!server) {
    return { ok: false, output: `MCP server not found: ${parsed.serverName}`, meta: { errorType: 'not_found' } };
  }

  try {
    const result = await withSession(server, baseCwd, async (session) =>
      session.request('tools/call', {
        name: parsed.toolName,
        arguments: args || {}
      })
    );

    return {
      ok: true,
      output: renderToolResult(result),
      meta: { mcpServer: server.name, mcpTool: parsed.toolName }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      output: `MCP tool call failed: ${message}`,
      meta: {
        mcpServer: server.name,
        mcpTool: parsed.toolName,
        errorType: classifyMcpError(message)
      }
    };
  }
}

export async function listMcpTools(baseCwd = process.cwd()) {
  const defs = await getMcpToolDefinitions(baseCwd);
  return defs.map((d) => ({ name: d?.function?.name, description: d?.function?.description || '' }));
}

/**
 * List all resources exposed by all configured MCP servers.
 * Returns an array of { serverName, uri, name, description, mimeType? }.
 */
export async function listMcpResources(baseCwd = process.cwd()) {
  const servers = await listMcpServers(baseCwd);
  const out = [];

  for (const server of servers) {
    try {
      const result = await withSession(server, baseCwd, (session) =>
        session.request('resources/list', {})
      );
      const resources = Array.isArray(result?.resources) ? result.resources : [];
      for (const r of resources) {
        if (r?.uri) {
          out.push({
            serverName: server.name,
            uri: String(r.uri),
            name: String(r.name || r.uri),
            description: String(r.description || ''),
            mimeType: r.mimeType || null
          });
        }
      }
    } catch {
      // Server may not support resources — silently skip
    }
  }

  return out;
}

/**
 * Read a specific MCP resource by URI.
 * Tries each server until one owns the URI.
 */
export async function readMcpResource(uri, baseCwd = process.cwd()) {
  const servers = await listMcpServers(baseCwd);

  for (const server of servers) {
    try {
      const result = await withSession(server, baseCwd, (session) =>
        session.request('resources/read', { uri })
      );
      if (result !== null && result !== undefined) {
        return {
          ok: true,
          serverName: server.name,
          uri,
          contents: result?.contents ?? result
        };
      }
    } catch {
      // Try next server
    }
  }

  return { ok: false, uri, error: `Resource not found: ${uri}` };
}

export async function getMcpHealth(baseCwd = process.cwd()) {
  const servers = await listMcpServers(baseCwd);
  const out = [];

  for (const server of servers) {
    const start = Date.now();
    try {
      const listed = await withSession(server, baseCwd, async (session) => session.request('tools/list', {}));
      const tools = Array.isArray(listed?.tools) ? listed.tools.length : 0;
      out.push({
        server: server.name,
        ok: true,
        toolCount: tools,
        latencyMs: Date.now() - start
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      out.push({
        server: server.name,
        ok: false,
        toolCount: 0,
        latencyMs: Date.now() - start,
        error: message,
        errorType: classifyMcpError(message)
      });
    }
  }

  return out;
}

export async function resetMcpRuntime() {
  toolsCache = { key: '', at: 0, tools: [] };
  mcpToolRegistry.clear();

  const sessions = [...sessionPool.values()];
  sessionPool.clear();
  for (const entry of sessions) {
    clearInterval(entry.heartbeatTimer);
    await entry.session.close().catch(() => {});
  }
}

export function getMcpRuntimeStats() {
  return {
    cachedTools: toolsCache.tools.length,
    pooledSessions: sessionPool.size
  };
}

function toMcpToolName(serverName, toolName) {
  return `mcp__${sanitize(serverName)}__${sanitize(toolName)}`;
}

function parseMcpToolName(name) {
  const match = /^mcp__([^_].*?)__(.+)$/.exec(String(name || ''));
  if (!match) {
    return null;
  }
  return {
    serverName: String(match[1]),
    toolName: String(match[2])
  };
}

function sanitize(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizeInputSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {}, additionalProperties: true };
  }
  const copy = { ...schema };
  if (!copy.type) {
    copy.type = 'object';
  }
  if (!copy.properties) {
    copy.properties = {};
  }
  if (copy.additionalProperties === undefined) {
    copy.additionalProperties = true;
  }
  return copy;
}

function renderToolResult(result) {
  if (result === undefined || result === null) {
    return '(no output)';
  }

  if (typeof result === 'string') {
    return result;
  }

  const content = result?.content;
  if (Array.isArray(content)) {
    const textParts = content
      .map((c) => {
        if (typeof c === 'string') {
          return c;
        }
        if (c?.type === 'text' && typeof c.text === 'string') {
          return c.text;
        }
        return JSON.stringify(c);
      })
      .filter(Boolean);
    if (textParts.length) {
      return textParts.join('\n');
    }
  }

  return JSON.stringify(result, null, 2);
}

function classifyMcpError(message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('timeout')) {
    return 'timeout';
  }
  if (text.includes('not found') || text.includes('enoent')) {
    return 'not_found';
  }
  if (text.includes('exited') || text.includes('closed')) {
    return 'process_exit';
  }
  if (text.includes('network') || text.includes('econn') || text.includes('enotfound')) {
    return 'network';
  }
  return 'unknown';
}

function sessionKey(server, baseCwd) {
  return JSON.stringify({
    baseCwd,
    name: server.name,
    command: server.command,
    args: server.args || []
  });
}

function reapIdleSessions() {
  const now = Date.now();
  for (const [key, entry] of sessionPool) {
    if (entry.closed || now - entry.lastUsedAt > SESSION_IDLE_TTL_MS) {
      clearInterval(entry.heartbeatTimer);
      entry.session.close().catch(() => {});
      sessionPool.delete(key);
    }
  }
}

async function withSession(server, baseCwd, fn) {
  const key = sessionKey(server, baseCwd);

  reapIdleSessions();
  let entry = sessionPool.get(key);

  if (!entry || entry.closed) {
    entry = await createSessionEntry(server, baseCwd, key);
    sessionPool.set(key, entry);
  }

  try {
    return await runQueued(entry, fn);
  } catch {
    // one-shot reconnect
    entry.closed = true;
    clearInterval(entry.heartbeatTimer);
    sessionPool.delete(key);
    await entry.session.close().catch(() => {});

    const retryEntry = await createSessionEntry(server, baseCwd, key);
    sessionPool.set(key, retryEntry);

    try {
      return await runQueued(retryEntry, fn);
    } catch (retryError) {
      retryEntry.closed = true;
      clearInterval(retryEntry.heartbeatTimer);
      sessionPool.delete(key);
      await retryEntry.session.close().catch(() => {});
      throw retryError;
    }
  }
}

async function runQueued(entry, fn) {
  const run = async () => {
    entry.lastUsedAt = Date.now();
    return fn(entry.session);
  };
  entry.queue = entry.queue.then(run, run);
  return entry.queue;
}

async function createSessionEntry(server, baseCwd, key) {
  const session = await createMcpSession(server, baseCwd);
  const entry = {
    session,
    lastUsedAt: Date.now(),
    closed: false,
    queue: Promise.resolve(),
    heartbeatTimer: null
  };

  entry.heartbeatTimer = setInterval(() => {
    if (entry.closed) {
      return;
    }
    runQueued(entry, (s) => s.request('tools/list', {})).catch(() => {
      entry.closed = true;
      clearInterval(entry.heartbeatTimer);
      sessionPool.delete(key);
      session.close().catch(() => {});
    });
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof entry.heartbeatTimer.unref === 'function') {
    entry.heartbeatTimer.unref();
  }

  return entry;
}

async function createMcpSession(server, baseCwd) {
  const proc = spawn(server.command, server.args || [], {
    cwd: baseCwd,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const transport = new StdioRpcTransport(proc);
  await transport.start();

  await transport.request('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: {
      name: 'ovopre',
      version: '0.1.0'
    }
  });

  await transport.notify('notifications/initialized', {});

  return {
    async request(method, params) {
      return transport.request(method, params);
    },
    async close() {
      await transport.close();
    }
  };
}

class StdioRpcTransport {
  constructor(proc) {
    this.proc = proc;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.stderrText = '';
  }

  async start() {
    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.stderr.on('data', (chunk) => {
      this.stderrText += String(chunk);
    });
    this.proc.on('exit', () => {
      const detail = this.stderrText.trim();
      this.onExit(new Error(detail ? `MCP process exited: ${detail}` : 'MCP process exited'));
    });
    this.proc.on('error', (err) => this.onExit(err));
  }

  async request(method, params) {
    const id = this.nextId++;
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params: params || {}
    };

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, 20000);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
    });

    this.writeMessage(payload);
    return promise;
  }

  async notify(method, params) {
    this.writeMessage({ jsonrpc: '2.0', method, params: params || {} });
  }

  writeMessage(obj) {
    if (this.closed) {
      throw new Error('MCP transport closed');
    }
    const json = JSON.stringify(obj);
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
    this.proc.stdin.write(header + json);
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);

    while (true) {
      const sep = this.buffer.indexOf('\r\n\r\n');
      if (sep === -1) {
        return;
      }

      const header = this.buffer.slice(0, sep).toString('utf8');
      const lenMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lenMatch) {
        this.buffer = Buffer.alloc(0);
        return;
      }
      const contentLength = Number(lenMatch[1]);
      const total = sep + 4 + contentLength;
      if (this.buffer.length < total) {
        return;
      }

      const body = this.buffer.slice(sep + 4, total).toString('utf8');
      this.buffer = this.buffer.slice(total);

      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }

      if (msg.id !== undefined) {
        const pending = this.pending.get(msg.id);
        if (!pending) {
          continue;
        }
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }

  onExit(error) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const [, pending] of this.pending) {
      pending.reject(error || new Error('MCP transport closed'));
    }
    this.pending.clear();
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.proc.kill();
    } catch {
      // ignore
    }
    for (const [, pending] of this.pending) {
      pending.reject(new Error('MCP transport closed'));
    }
    this.pending.clear();
  }
}
