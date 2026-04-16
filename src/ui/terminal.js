import path from 'node:path';

// ─── ANSI palette ────────────────────────────────────────────────────────────
const C = {
  reset:         '\x1b[0m',
  bold:          '\x1b[1m',
  dim:           '\x1b[2m',
  cyan:          '\x1b[36m',
  brightCyan:    '\x1b[96m',
  blue:          '\x1b[34m',
  brightBlue:    '\x1b[94m',
  green:         '\x1b[32m',
  brightGreen:   '\x1b[92m',
  yellow:        '\x1b[33m',
  brightYellow:  '\x1b[93m',
  red:           '\x1b[31m',
  magenta:       '\x1b[35m',
  brightMagenta: '\x1b[95m',
  brightBlack:   '\x1b[90m',   // dark gray / muted
};

// ─── OVOPRE ASCII logo (block style, 6 lines × ~52 cols) ─────────────────────

const LOGO = [
  ' ██████╗ ██╗   ██╗ ██████╗ ██████╗ ██████╗ ███████╗',
  '██╔═══██╗██║   ██║██╔═══██╗██╔══██╗██╔══██╗██╔════╝',
  '██║   ██║╚██╗ ██╔╝██║   ██║██████╔╝██████╔╝█████╗  ',
  '██║   ██║ ╚████╔╝ ██║   ██║██╔═══╝ ██╔══██╗██╔══╝  ',
  '╚██████╔╝  ╚██╔╝  ╚██████╔╝██║     ██║  ██║███████╗',
  ' ╚═════╝    ╚═╝    ╚═════╝ ╚═╝     ╚═╝  ╚═╝╚══════╝',
];

// Top-to-bottom gradient: bright cyan → cyan → blue → shadow
const LOGO_COLORS = [
  C.brightCyan + C.bold,
  C.brightCyan,
  C.cyan,
  C.cyan,
  C.blue,
  C.brightBlack,
];

// ─── TTY helpers ─────────────────────────────────────────────────────────────

export function hasColor(stream = process.stdout) {
  return !!(stream && stream.isTTY);
}

// ─── Banner ───────────────────────────────────────────────────────────────────

export function renderBanner({ model, cwd, stream = process.stdout }) {
  const project  = path.basename(cwd || process.cwd());
  const modelTag = model || 'unknown';

  if (!hasColor(stream)) {
    return [
      '',
      '  OVOPRE',
      `  model=${modelTag}  project=${project}`,
      '  ' + '─'.repeat(52),
      '  /help  /plan <goal>  /clear  /status  /exit',
    ].join('\n');
  }

  const art = LOGO.map((line, i) => `  ${LOGO_COLORS[i]}${line}${C.reset}`).join('\n');

  const cols   = stream.columns || 80;
  const sepLen = Math.max(52, Math.min(cols - 4, 72));
  const sep    = `  ${C.brightBlack}${'─'.repeat(sepLen)}${C.reset}`;

  const modelLabel = `${C.green}${C.bold}model${C.reset}`;
  const projLabel  = `${C.brightBlack}project${C.reset}`;
  const dot        = `${C.brightBlack}◈${C.reset}`;
  const infoLine   = `  ${modelLabel} ${dot} ${C.bold}${modelTag}${C.reset}   ${projLabel} ${dot} ${C.brightBlack}${project}${C.reset}`;
  const hintLine   = `  ${C.brightBlack}/help  /plan <goal>  /clear  /status  /exit${C.reset}`;

  return ['', art, sep, infoLine, hintLine, sep].join('\n');
}

// ─── Prompt / response markers ───────────────────────────────────────────────

export function promptUser() {
  if (!hasColor()) return '> ';
  // │ forms the left wall of the input box drawn by renderInputBox()
  return `  ${C.brightBlack}│${C.reset}  ${C.brightCyan}${C.bold}❯${C.reset} `;
}

/**
 * Returns the top/bottom borders of the input box, or null when color is off.
 * Width adapts to the terminal but is clamped to [44, 72].
 */
export function renderInputBox(cols = 80) {
  if (!hasColor()) return null;
  const width = Math.max(44, Math.min(cols - 4, 72));
  const dash = '─'.repeat(width);
  return {
    top: `  ${C.brightBlack}╭${dash}╮${C.reset}`,
    bot: `  ${C.brightBlack}╰${dash}╯${C.reset}`,
  };
}

/** Printed before the first streaming token of an assistant response. */
export function formatAssistantHeader() {
  if (!hasColor()) return '\n';
  return `\n  ${C.brightBlack}◈ assistant${C.reset}\n`;
}

export function formatAssistant(text) {
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
  const parts = [`${phase || 'idle'}`, `${model || '?'}`, `${totalTokens}t`];
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
 */
export function formatToolLine(name, ok, durationMs, arg = '') {
  const argStr = arg ? `(${arg})` : '';
  const ms     = fmtDuration(durationMs);

  if (!hasColor()) {
    return `  ${ok ? '●' : '○'} ${name}${argStr}${ms ? '  ' + ms : ''}${ok ? '' : '  err'}`;
  }

  const bullet = ok ? `${C.green}⏺${C.reset}` : `${C.yellow}⏺${C.reset}`;
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
  const tick   = ok ? `${C.green}✓${C.reset}` : `${C.yellow}✗${C.reset}`;
  const timing = ms      ? `${C.brightBlack}  ${ms}${C.reset}`        : '';
  const prev   = preview ? `${C.brightBlack}  → ${preview}${C.reset}` : '';
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
