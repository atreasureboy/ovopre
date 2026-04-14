import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureConfigDir, getSessionDir } from './config.js';

export async function loadSession(sessionId = 'default') {
  await ensureConfigDir();
  const sessionPath = getSessionPath(sessionId);

  try {
    const raw = await fs.readFile(sessionPath, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.messages)) {
      return data.messages;
    }
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }

  return [];
}

export async function saveSession(messages, sessionId = 'default') {
  await ensureConfigDir();
  const sessionPath = getSessionPath(sessionId);
  const payload = { messages, updatedAt: new Date().toISOString() };
  await fs.writeFile(sessionPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

export async function listSessions() {
  await ensureConfigDir();
  const dir = getSessionDir();
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    const filePath = path.join(dir, entry.name);
    const sessionId = entry.name.replace(/\.json$/, '');
    const stat = await fs.stat(filePath);
    out.push({
      sessionId,
      filePath,
      updatedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size
    });
  }

  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

export async function deleteSession(sessionId) {
  await ensureConfigDir();
  const sessionPath = getSessionPath(sessionId);
  await fs.rm(sessionPath, { force: true });
}

export async function readSessionMeta(sessionId) {
  await ensureConfigDir();
  const sessionPath = getSessionPath(sessionId);
  const raw = await fs.readFile(sessionPath, 'utf8');
  const data = JSON.parse(raw);
  const messages = Array.isArray(data.messages) ? data.messages : [];
  return {
    sessionId,
    path: sessionPath,
    updatedAt: data.updatedAt || null,
    messageCount: messages.length
  };
}

export function getSessionPath(sessionId) {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getSessionDir(), `${safeId}.json`);
}
