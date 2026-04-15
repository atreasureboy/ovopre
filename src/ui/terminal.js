import path from 'node:path';

// ─── ANSI palette ────────────────────────────────────────────────────────────
const C = {
  reset:        '\x1b[0m',
  bold:         '\x1b[1m',
  dim:          '\x1b[2m',
  cyan:         '\x1b[36m',
  brightCyan:   '\x1b[96m',
  blue:         '\x1b[34m',
  brightBlue:   '\x1b[94m',
  green:        '\x1b[32m',
  brightGreen:  '\x1b[92m',
  yellow:       '\x1b[33m',
  brightYellow: '\x1b[93m',
  red:          '\x1b[31m',
  brightBlack:  '\x1b[90m',   // "dark gray" / muted
};

// ─── TTY helpers ─────────────────────────────────────────────────────────────

export function hasColor(stream = process.stdout) {
  return !!(stream && stream.isTTY);
}

function c(text, ...codes) {
  // apply ANSI codes only when stdout is a TTY
  if (!hasColor()) return text;
  return codes.join('') + text + C.reset;
}

function cs(text, ...codes) {
  // stream-aware version (for banner which uses a stream param)
  return (stream) => hasColor(stream) ? codes.join('') + text + C.reset : text;
}

// ─── Banner ───────────────────────────────────────────────────────────────────

export function renderBanner({ model, cwd, stream = process.stdout }) {
  const cols  = stream.columns || 80;
  const width = Math.max(40, Math.min(cols - 2, 72));
  const project  = path.basename(cwd || process.cwd());
  const modelTag = (model || 'unknown');

  if (!hasColor(stream)) {
    return [
      '',
      `  ovopre  ${modelTag}  ${project}`,
      '  ' + '─'.repeat(width - 2),
    ].join('\n');
  }

  const logo  = `${C.brightCyan}${C.bold}ovopre${C.reset}`;
  const mod   = `${C.green}${modelTag}${C.reset}`;
  const proj  = `${C.brightBlack}${project}${C.reset}`;
  const sep   = `${C.brightBlack}${'─'.repeat(width)}${C.reset}`;
  const hint  = `${C.brightBlack}  /help  /plan  /clear  /status  /task  /exit${C.reset}`;

  return ['', `  ${logo}  ${mod}  ${proj}`, `  ${sep}`, hint].join('\n');
}

// ─── Prompt / response markers ───────────────────────────────────────────────

export function promptUser() {
  if (!hasColor()) return '> ';
  return `${C.brightBlue}${C.bold}>${C.reset} `;
}

/** Returns the prefix string that precedes a streamed assistant response. */
export function formatAssistantPrefix() {
  // Intentionally empty — response text flows without a label so the terminal
  // looks clean. A blank line before the first token (added in chat.js) gives
  // enough visual separation.
  return '';
}

/** Used for non-streaming (buffered) responses — adds a subtle label. */
export function formatAssistant(text) {
  if (!hasColor()) return text || '';
  return text || '';
}

// ─── Informational / status text ─────────────────────────────────────────────

export function formatInfo(text) {
  return hasColor() ? `${C.brightBlack}${text}${C.reset}` : text;
}

export function formatSuccess(text) {
  return hasColor() ? `${C.brightGreen}${text}${C.reset}` : text;
}

export function formatWarn(text) {
  return hasColor() ? `${C.yellow}${text}${C.reset}` : text;
}

// ─── Status bar (verbose mode only) ──────────────────────────────────────────

export function estimateCostFromUsage(usage) {
  const inRate  = parseRate(process.env.OVOPRE_PRICE_INPUT_PER_1M);
  const outRate = parseRate(process.env.OVOPRE_PRICE_OUTPUT_PER_1M);
  if (inRate === null || outRate === null || !usage) return null;
  const prompt     = Number(usage.prompt_tokens     || 0);
  const completion = Number(usage.completion_tokens || 0);
  return Number(((prompt / 1e6) * inRate + (completion / 1e6) * outRate).toFixed(6));
}

export function formatStatusBar({ phase, model, usage, toolCalls = 0, round = null }) {
  const totalTokens = Number(usage?.total_tokens || 0);
  const cost = estimateCostFromUsage(usage);
  const parts = [
    `${phase || 'idle'}`,
    `${model || '?'}`,
    `${totalTokens}t`,
  ];
  if (toolCalls > 0) parts.push(`${toolCalls} tools`);
  if (cost !== null) parts.push(`$${cost.toFixed(4)}`);
  if (round) parts.push(`r${round}`);
  const text = parts.join('  ');
  return hasColor() ? `${C.brightBlack}  ${text}${C.reset}` : `  ${text}`;
}

// ─── Tool display ─────────────────────────────────────────────────────────────

/**
 * Single-line tool call display (default mode).
 *
 *   ⏺ read_file(README.md)  3ms
 *   ⏺ bash(npm test)  1.2s
 *   ⏺ write_file(readme1.md)  45ms  ✗
 *
 * @param {string}  name        tool name
 * @param {boolean} ok          success?
 * @param {number}  durationMs  execution time
 * @param {string}  [arg]       primary argument (already shortened)
 */
export function formatToolLine(name, ok, durationMs, arg = '') {
  const argStr = arg ? `(${arg})` : '';
  const ms     = fmtDuration(durationMs);

  if (!hasColor()) {
    return `  ${ok ? '●' : '○'} ${name}${argStr}${ms ? '  ' + ms : ''}${ok ? '' : '  err'}`;
  }

  const bullet = ok
    ? `${C.green}⏺${C.reset}`
    : `${C.yellow}⏺${C.reset}`;
  const label  = `${C.bold}${name}${C.reset}`;
  const argTxt = arg ? `${C.brightBlack}(${arg})${C.reset}` : '';
  const timing = ms  ? `${C.brightBlack}  ${ms}${C.reset}` : '';
  const err    = ok  ? '' : `  ${C.yellow}✗${C.reset}`;

  return `  ${bullet} ${label}${argTxt}${timing}${err}`;
}

/**
 * Verbose-mode tool-start line.
 *   ⏺ read_file  #1  …
 */
export function formatToolStart(name, index) {
  if (!hasColor()) return `  ● ${name}  #${index}  …`;
  return `  ${C.brightBlack}⏺${C.reset} ${C.bold}${name}${C.reset}${C.brightBlack}  #${index}  …${C.reset}`;
}

/**
 * Verbose-mode tool-end line.
 *   ✓ read_file  (12ms)  → first 120 chars of output…
 */
export function formatToolEnd(name, ok, durationMs, details = null) {
  const ms      = fmtDuration(durationMs);
  const preview = buildPreview(details);
  if (!hasColor()) {
    return `  ${ok ? '✓' : '✗'} ${name}${ms ? '  ' + ms : ''}${preview ? '  → ' + preview : ''}`;
  }
  const tick    = ok ? `${C.green}✓${C.reset}` : `${C.yellow}✗${C.reset}`;
  const timing  = ms      ? `${C.brightBlack}  ${ms}${C.reset}`              : '';
  const prev    = preview ? `${C.brightBlack}  → ${preview}${C.reset}`       : '';
  return `    ${tick} ${C.brightBlack}${name}${C.reset}${timing}${prev}`;
}

// ─── Tool arg extraction ──────────────────────────────────────────────────────

/**
 * Extract the most meaningful argument from a tool call to show inline:
 *   ⏺ read_file(README.md)  32ms
 */
export function extractPrimaryArg(name, args) {
  if (!args || typeof args !== 'object') return '';
  const candidates = [
    args.path, args.file_path, args.filename, args.file,
    args.command, args.cmd,
    args.query, args.pattern,
    args.url,
  ];
  for (const v of candidates) {
    if (v && typeof v === 'string') {
      const short = v.includes('/') ? v.split('/').filter(Boolean).pop() || v : v;
      return short.length > 40 ? short.slice(0, 39) + '…' : short;
    }
  }
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v.length > 0) {
      return v.length > 40 ? v.slice(0, 39) + '…' : v;
    }
  }
  return '';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(ms) {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildPreview(details) {
  if (!details || process.env.OVOPRE_TOOL_OUTPUT_PREVIEW === '0') return '';
  const text = String(details.output || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const max = 100;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parseRate(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
