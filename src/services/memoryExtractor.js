import fs from 'node:fs/promises';
import path from 'node:path';
import { createChatCompletion } from '../core/openaiClient.js';
import { getConfigDir } from '../core/config.js';

const MAX_LOAD_FILES = 3;   // how many recent memory files to inject on startup
const MAX_MEMORY_CHARS = 6000; // max chars from memories to inject into system prompt

const EXTRACT_SYSTEM = [
  'You are a session historian for a coding AI agent.',
  'Analyze the conversation excerpt and extract key information as a compact reference document.',
  '',
  'Include only what is non-obvious and worth remembering:',
  '- Goals and requirements stated by the user',
  '- Files created, modified, or deleted (with key changes)',
  '- Technical decisions and their rationale',
  '- Project-specific facts, patterns, or constraints discovered',
  '- Issues resolved and how',
  '- Pending or follow-up items',
  '',
  'Format as concise markdown with named sections. Omit empty sections.',
  'If there is nothing worth remembering, reply with exactly: NOTHING'
].join('\n');

function getMemoriesDir(baseCwd) {
  return path.join(getConfigDir(baseCwd), 'memories');
}

/**
 * Extract key memories from a conversation and save them to disk.
 * Called at the end of an interactive chat session.
 *
 * @param {Array}  messages  - The full message list (system excluded automatically)
 * @param {object} config    - Runtime config (baseURL, apiKey, model)
 * @param {object} options   - { sessionId, cwd }
 */
export async function extractAndSaveMemory(messages, config, options = {}) {
  const nonSystem = messages.filter((m) => m.role !== 'system');
  if (nonSystem.length < 4) return null; // too short to bother

  const excerpt = serializeMessages(nonSystem);
  if (excerpt.length < 200) return null;

  let memory;
  try {
    const result = await createChatCompletion({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0,
      timeoutMs: 45000,
      maxRetries: 1,
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: `Conversation to analyze:\n\n${excerpt}` }
      ]
    });

    memory = (result.text || '').trim();
    if (!memory || memory === 'NOTHING') return null;
  } catch {
    return null; // extraction failing silently is fine
  }

  const sessionId = options.sessionId || 'default';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-${sessionId.replace(/[^a-z0-9_-]/gi, '_')}.md`;
  const dir = getMemoriesDir(options.cwd || process.cwd());
  await fs.mkdir(dir, { recursive: true });

  const frontmatter = [
    '---',
    `session: ${sessionId}`,
    `date: ${new Date().toISOString()}`,
    `model: ${config.model || 'unknown'}`,
    `messages: ${nonSystem.length}`,
    '---',
    ''
  ].join('\n');

  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, frontmatter + memory + '\n', 'utf8');
  return filePath;
}

/**
 * Load recent session memories to inject into the system prompt.
 * Returns a string to append (empty string if no memories found).
 *
 * @param {string} baseCwd
 */
export async function loadMemoriesForPrompt(baseCwd = process.cwd()) {
  const dir = getMemoriesDir(baseCwd);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return ''; // no memories dir yet
  }

  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
    .sort((a, b) => b.name.localeCompare(a.name)) // most recent first
    .slice(0, MAX_LOAD_FILES);

  if (!files.length) return '';

  const blocks = [];
  let totalChars = 0;

  for (const file of files) {
    try {
      let content = await fs.readFile(file.path, 'utf8');
      // Strip YAML frontmatter
      content = content.replace(/^---[\s\S]*?---\n/, '').trim();
      if (!content) continue;
      const remaining = MAX_MEMORY_CHARS - totalChars;
      if (remaining <= 0) break;
      const slice = content.slice(0, remaining);
      blocks.push(slice);
      totalChars += slice.length;
    } catch {
      // skip unreadable files
    }
  }

  if (!blocks.length) return '';

  return [
    '## Prior Session Memories',
    '(Automatically extracted from recent conversations — use as context.)',
    '',
    blocks.join('\n\n---\n\n')
  ].join('\n');
}

// ─── helpers ────────────────────────────────────────────────────────────────

function serializeMessages(messages) {
  return messages
    .slice(-40) // keep last 40 messages to stay within token budget
    .map((m) => {
      const role = String(m.role || 'unknown').toUpperCase();
      let body;
      if (typeof m.content === 'string') {
        body = m.content;
      } else if (Array.isArray(m.content)) {
        body = m.content.map((c) => (c?.type === 'text' ? c.text : '')).join('\n');
      } else if (Array.isArray(m.tool_calls)) {
        body = `[tool calls: ${m.tool_calls.map((tc) => tc?.function?.name || '?').join(', ')}]`;
      } else {
        body = JSON.stringify(m.content || '');
      }
      return `[${role}]\n${body.slice(0, 2000)}`;
    })
    .join('\n\n');
}
