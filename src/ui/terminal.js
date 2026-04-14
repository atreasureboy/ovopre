import os from 'node:os';
import path from 'node:path';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  brightCyan: '\x1b[96m',
  blue: '\x1b[34m',
  brightBlue: '\x1b[94m',
  green: '\x1b[32m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  brightBlack: '\x1b[90m'
};

export function hasColor(stream = process.stdout) {
  return !!(stream && stream.isTTY);
}

function paint(text, color, stream = process.stdout) {
  if (!hasColor(stream)) return text;
  return `${color}${text}${ANSI.reset}`;
}

export function renderBanner({ model, cwd, stream = process.stdout }) {
  const width = Math.max(44, Math.min(78, (stream.columns || 80) - 4));
  const line = '─'.repeat(width);
  const project = path.basename(cwd || process.cwd());
  const host = os.hostname();
  const top = paint(line, ANSI.brightBlack, stream);

  return [
    '',
    ` ${paint('OVOPRE', ANSI.brightCyan + ANSI.bold, stream)} ${paint('Terminal Coding Agent', ANSI.dim, stream)}`,
    ` ${paint('model', ANSI.dim, stream)} ${paint(model || 'unknown', ANSI.green, stream)}  ${paint('project', ANSI.dim, stream)} ${paint(project, ANSI.blue, stream)}  ${paint('host', ANSI.dim, stream)} ${paint(host, ANSI.brightBlack, stream)}`,
    ` ${top}`,
    ` ${paint('Commands: /help /plan /status /usage /session /plugins /skills /mcp /models /task /tasks /exit', ANSI.dim, stream)}`
  ].join('\n');
}

export function promptUser() {
  if (!hasColor(process.stdout)) return 'you> ';
  return `${ANSI.brightBlue}${ANSI.bold}you${ANSI.reset}${ANSI.brightBlack} ❯ ${ANSI.reset}`;
}

export function formatAssistant(text) {
  if (!hasColor(process.stdout)) return `ovopre> ${text}`;
  return `${ANSI.brightCyan}${ANSI.bold}ovopre${ANSI.reset}${ANSI.brightBlack} › ${ANSI.reset}${text}`;
}

export function formatInfo(text) {
  return paint(text, ANSI.dim);
}

export function formatSuccess(text) {
  return paint(text, ANSI.brightGreen);
}

export function formatWarn(text) {
  return paint(text, ANSI.yellow);
}

export function estimateCostFromUsage(usage) {
  const inRate = parseRate(process.env.OVOPRE_PRICE_INPUT_PER_1M);
  const outRate = parseRate(process.env.OVOPRE_PRICE_OUTPUT_PER_1M);
  if (inRate === null || outRate === null || !usage) {
    return null;
  }
  const prompt = Number(usage.prompt_tokens || 0);
  const completion = Number(usage.completion_tokens || 0);
  const value = (prompt / 1_000_000) * inRate + (completion / 1_000_000) * outRate;
  return Number(value.toFixed(6));
}

export function formatStatusBar({ phase, model, usage, toolCalls = 0, round = null }) {
  const p = phase || 'idle';
  const m = model || 'unknown';
  const totalTokens = Number(usage?.total_tokens || 0);
  const cost = estimateCostFromUsage(usage);
  const costText = cost === null ? 'cost n/a' : `cost $${cost.toFixed(6)}`;
  const roundText = round ? `r${round}` : '-';
  const text = `[${p}] model=${m} tokens=${totalTokens} tools=${toolCalls} ${costText} round=${roundText}`;
  return hasColor(process.stdout) ? `${ANSI.brightBlack}${text}${ANSI.reset}` : text;
}

export function formatToolStart(name, index) {
  const label = `tool#${index} ${name}`;
  if (!hasColor(process.stdout)) {
    return `├─ ${label} ...`;
  }
  return `${ANSI.magenta}├─${ANSI.reset} ${ANSI.brightYellow}${label}${ANSI.reset} ${ANSI.dim}...${ANSI.reset}`;
}

export function formatToolEnd(name, ok, durationMs) {
  const status = ok ? 'ok' : 'error';
  const suffix = Number.isFinite(durationMs) ? ` (${durationMs}ms)` : '';
  if (!hasColor(process.stdout)) {
    return `└─ ${name} ${status}${suffix}`;
  }
  const color = ok ? ANSI.brightGreen : ANSI.yellow;
  return `${ANSI.magenta}└─${ANSI.reset} ${name} ${color}${status}${ANSI.reset}${ANSI.dim}${suffix}${ANSI.reset}`;
}

function parseRate(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
