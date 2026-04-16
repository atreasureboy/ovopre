import path from 'node:path';

// ─── ANSI palette ─────────────────────────────────────────────────────────────
// Uses 256-color codes for consistent rendering across terminals.
const C = {
  reset:        '\x1b[0m',
  bold:         '\x1b[1m',
  dim:          '\x1b[2m',
  // ── purple / teal / amber palette ──
  neonPink:     '\x1b[38;5;141m',  // soft lavender-purple  — logo top / primary accent
  neonCyan:     '\x1b[38;5;80m',   // steel teal            — logo mid / borders / labels
  neonYellow:   '\x1b[38;5;214m',  // warm amber            — logo base / prompt arrow
  neonGreen:    '\x1b[38;5;114m',  // sage green            — success / tool ok
  neonRed:      '\x1b[38;5;204m',  // rose-coral            — errors
  neonBlue:     '\x1b[38;5;105m',  // medium purple         — accents
  dimGray:      '\x1b[38;5;240m',  // dark gray             — box-drawing / decorative only
  text:         '\x1b[38;5;252m',  // near-white            — readable info text / labels
  // ── aliases kept for internal use ──
  brightBlack:  '\x1b[38;5;240m',
  green:        '\x1b[38;5;114m',
  yellow:       '\x1b[38;5;214m',
};

// ─── OVOPRE ASCII logo ─────────────────────────────────────────────────────────
const LOGO = [
  ' ██████╗ ██╗   ██╗ ██████╗ ██████╗ ██████╗ ███████╗',
  '██╔═══██╗██║   ██║██╔═══██╗██╔══██╗██╔══██╗██╔════╝',
  '██║   ██║╚██╗ ██╔╝██║   ██║██████╔╝██████╔╝█████╗  ',
  '██║   ██║ ╚████╔╝ ██║   ██║██╔═══╝ ██╔══██╗██╔══╝  ',
  '╚██████╔╝  ╚██╔╝  ╚██████╔╝██║     ██║  ██║███████╗',
  ' ╚═════╝    ╚═╝    ╚═════╝ ╚═╝     ╚═╝  ╚═╝╚══════╝',
];

// Cyberpunk gradient: hot pink → neon cyan → neon yellow → shadow
const LOGO_COLORS = [
  C.neonPink + C.bold,
  C.neonPink,
  C.neonCyan,
  C.neonCyan,
  C.neonYellow,
  C.dimGray,
];

// ─── TTY helpers ──────────────────────────────────────────────────────────────
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
      '  OVOPRE — SYSTEM ONLINE',
      `  MODEL=${modelTag}  PROJECT=${project}`,
      '  ' + '═'.repeat(52),
      '  /help  /plan <goal>  /clear  /status  /exit',
    ].join('\n');
  }

  const cols  = stream.columns || 80;
  const W     = Math.max(52, Math.min(cols - 2, 78)); // banner inner width

  // Helpers for banner lines (all left-anchored, no right border → industrial aesthetic)
  const line   = (ch = '═') => `  ${C.dimGray}${ch.repeat(W)}${C.reset}`;
  const top    = `  ${C.dimGray}╔${'═'.repeat(W)}${C.reset}`;
  const bot    = `  ${C.dimGray}╚${'═'.repeat(W)}${C.reset}`;
  const div    = (tag) => {
    const rest = Math.max(0, W - 2 - tag.length);
    return `  ${C.dimGray}╠══${C.reset}${C.neonCyan}${tag}${C.reset}${C.dimGray}${'═'.repeat(rest)}${C.reset}`;
  };
  const row    = (content) => `  ${C.dimGray}║${C.reset}  ${content}`;

  const art = LOGO.map((l, i) => row(`${LOGO_COLORS[i]}${l}${C.reset}`)).join('\n');

  const modelPart = `${C.neonPink}${C.bold}MODEL${C.reset} ${C.dimGray}▸${C.reset} ${C.bold}${modelTag}${C.reset}`;
  const projPart  = `${C.dimGray}PROJECT${C.reset} ${C.dimGray}▸${C.reset} ${C.neonCyan}${project}${C.reset}`;
  const hintPart  = `${C.text}/help  /plan <goal>  /clear  /status  /exit${C.reset}`;

  return [
    '',
    top,
    art,
    div('[ SYS ]'),
    row(`${modelPart}   ${projPart}`),
    div('[ CMD ]'),
    row(hintPart),
    bot,
  ].join('\n');
}

// ─── Input box ────────────────────────────────────────────────────────────────

/**
 * Returns { top, bot } strings for the input box frame, or null in no-color mode.
 * Uses full-enclosure double-line borders (╔═[ INPUT ]═╗ … ╚═════════╝).
 */
export function renderInputBox(cols = 80) {
  if (!hasColor()) return null;

  // Total visible width of ╔═...═╗ (includes the 2 leading-space indent)
  const boxW   = Math.max(46, Math.min(cols - 2, 78));
  const inner  = boxW - 2;   // chars between ╔ and ╗

  // ╔══[ INPUT ]══...══╗
  const tag    = '[ INPUT ]';                              // 9 visible chars
  const lFill  = Math.floor((inner - tag.length) / 2);
  const rFill  = inner - tag.length - lFill;

  const top = (
    `  ${C.dimGray}╔${'═'.repeat(lFill)}${C.reset}` +
    `${C.neonYellow}${C.bold}${tag}${C.reset}` +
    `${C.dimGray}${'═'.repeat(rFill)}╗${C.reset}`
  );
  const bot = `  ${C.dimGray}╚${'═'.repeat(inner)}╝${C.reset}`;

  return { top, bot };
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

export function promptUser() {
  if (!hasColor()) return '> ';
  // ║ aligns with ╔/╚ in renderInputBox (same column position)
  return `  ${C.dimGray}║${C.reset}  ${C.neonYellow}${C.bold}▶${C.reset} `;
}

// ─── Assistant / output headers ──────────────────────────────────────────────

/** Printed before the first streaming token (or before a buffered response). */
export function formatAssistantHeader() {
  if (!hasColor()) return '\n';
  const cols  = process.stdout.columns || 80;
  const W     = Math.max(40, Math.min(cols - 2, 78));
  const tag   = '[ SYS:OUTPUT ]';                         // 14 visible chars
  const rest  = Math.max(0, W - 2 - tag.length);
  return (
    `\n  ${C.dimGray}╔══${C.reset}` +
    `${C.neonCyan}${C.bold}${tag}${C.reset}` +
    `${C.dimGray}${'═'.repeat(rest)}${C.reset}\n`
  );
}

export function formatAssistant(text) {
  return text || '';
}

// ─── Informational / status text ─────────────────────────────────────────────

export function formatInfo(text) {
  return hasColor() ? `${C.text}${text}${C.reset}` : text;
}

export function formatSuccess(text) {
  return hasColor() ? `${C.neonGreen}${text}${C.reset}` : text;
}

export function formatWarn(text) {
  return hasColor() ? `${C.neonYellow}${text}${C.reset}` : text;
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
  const cost  = estimateCostFromUsage(usage);
  const parts = [`${phase || 'idle'}`, `${model || '?'}`, `${totalTokens}t`];
  if (toolCalls > 0) parts.push(`${toolCalls} calls`);
  if (cost !== null)  parts.push(`$${cost.toFixed(4)}`);
  if (round)          parts.push(`r${round}`);
  const text = parts.join('  ');
  return hasColor()
    ? `  ${C.text}[ ${text} ]${C.reset}`
    : `  [ ${text} ]`;
}

// ─── Tool display ─────────────────────────────────────────────────────────────

/**
 * Single-line tool call.
 *   ▶ read_file(README.md)  3ms
 *   ✗ bash(npm test)  1.2s  [ERR]
 */
export function formatToolLine(name, ok, durationMs, arg = '') {
  const ms     = fmtDuration(durationMs);
  const argStr = arg ? `(${arg})` : '';

  if (!hasColor()) {
    return `  ${ok ? '▶' : '✗'} ${name}${argStr}${ms ? '  ' + ms : ''}${ok ? '' : '  [ERR]'}`;
  }

  const bullet = ok ? `${C.neonGreen}▶${C.reset}` : `${C.neonRed}✗${C.reset}`;
  const label  = `${C.bold}${name}${C.reset}`;
  const argTxt = arg ? `${C.text}(${arg})${C.reset}` : '';
  const timing = ms  ? `${C.text}  ${ms}${C.reset}` : '';
  const err    = ok  ? '' : `  ${C.neonRed}[ERR]${C.reset}`;

  return `  ${bullet} ${label}${argTxt}${timing}${err}`;
}

/** Verbose-mode tool-start: ▷ read_file  #1  … */
export function formatToolStart(name, index) {
  if (!hasColor()) return `  ▷ ${name}  #${index}  …`;
  return (
    `  ${C.text}▷${C.reset} ${C.neonCyan}${name}${C.reset}` +
    `${C.text}  #${index}  …${C.reset}`
  );
}

/** Verbose-mode tool-end: ✓ read_file  12ms  → preview… */
export function formatToolEnd(name, ok, durationMs, details = null) {
  const ms      = fmtDuration(durationMs);
  const preview = buildPreview(details);
  if (!hasColor()) {
    return `  ${ok ? '✓' : '✗'} ${name}${ms ? '  ' + ms : ''}${preview ? '  → ' + preview : ''}`;
  }
  const tick    = ok ? `${C.neonGreen}✓${C.reset}` : `${C.neonRed}✗${C.reset}`;
  const timing  = ms      ? `${C.text}  ${ms}${C.reset}`        : '';
  const prev    = preview ? `${C.text}  → ${preview}${C.reset}` : '';
  return `    ${tick} ${C.text}${name}${C.reset}${timing}${prev}`;
}

// ─── Tool arg extraction ──────────────────────────────────────────────────────

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

// ─── Spinner ──────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_COLORS = [C.neonPink, C.neonCyan, C.neonYellow, C.neonCyan];
const SPINNER_DOTS   = ['   ', '.  ', '.. ', '...'];

/**
 * Create a spinner instance.
 *   spinner.start('THINKING')
 *   spinner.update('EXECUTING')
 *   spinner.stop()
 * No-op in non-color / non-TTY mode.
 */
export function createSpinner(defaultLabel = 'PROCESSING') {
  if (!hasColor()) {
    return { start: () => {}, update: () => {}, stop: () => {} };
  }

  let tick = 0, timer = null, active = false, currentLabel = defaultLabel;

  function render() {
    const frame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
    const color = SPINNER_COLORS[tick % SPINNER_COLORS.length];
    const dots  = SPINNER_DOTS[Math.floor(tick / 3) % SPINNER_DOTS.length];
    process.stdout.write(
      `\r  ${color}${frame}${C.reset}  ` +
      `${C.text}⟨ SYS ⟩${C.reset} ` +
      `${C.neonCyan}${currentLabel}${C.reset}` +
      `${C.text}${dots}${C.reset}  `
    );
    tick++;
  }

  return {
    start(label = defaultLabel) {
      currentLabel = label;
      if (active) return;
      active = true;
      render();
      timer = setInterval(render, 80);
    },
    update(label) {
      currentLabel = label;
    },
    stop() {
      if (!active) return;
      active = false;
      if (timer) { clearInterval(timer); timer = null; }
      process.stdout.write('\r\x1b[2K');
    },
  };
}

// ─── Section divider ──────────────────────────────────────────────────────────

/**
 * A thin separator line: ──[ LABEL ]── in dimGray.
 * Falls back to a plain dashed line in no-color mode.
 */
export function formatDivider(label = '') {
  if (!hasColor()) return label ? `--- ${label} ---` : '─────────────────────';
  const cols = process.stdout.columns || 80;
  const W    = Math.max(40, Math.min(cols - 2, 78));
  if (!label) return `  ${C.dimGray}${'─'.repeat(W)}${C.reset}`;
  const tag  = `[ ${label} ]`;
  const fill = Math.max(0, W - 4 - tag.length);
  return `  ${C.dimGray}──${C.reset}${C.dimGray}${tag}${'─'.repeat(fill)}${C.reset}`;
}

// ─── Session info line ────────────────────────────────────────────────────────

/**
 * Styled one-liner shown after the banner:
 *   ◈ session=default  ◈ tools=on  ◈ https://api.openai.com
 */
export function formatSessionLine(sessionId, toolsOn, baseURL) {
  const dot = hasColor() ? `${C.neonPink}◈${C.reset}` : '◈';
  const kv  = (k, v) => hasColor()
    ? `${dot} ${C.text}${k}=${C.reset}${C.neonCyan}${v}${C.reset}`
    : `${dot} ${k}=${v}`;

  const toolTag = toolsOn
    ? (hasColor() ? `${dot} ${C.text}tools=${C.reset}${C.neonGreen}on${C.reset}` : `${dot} tools=on`)
    : (hasColor() ? `${dot} ${C.text}tools=${C.reset}${C.neonRed}off${C.reset}` : `${dot} tools=off`);

  const urlPart = hasColor()
    ? `${dot} ${C.text}${String(baseURL || '').replace(/\/$/, '')}${C.reset}`
    : `${dot} ${baseURL || ''}`;

  return `  ${kv('session', sessionId || 'default')}   ${toolTag}   ${urlPart}`;
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
