/**
 * Analyzes token distribution across a message array.
 * Uses a 4-chars/token heuristic (no tokenizer available).
 *
 * Useful for compaction decisions and debugging context usage.
 */

export function analyzeContext(messages) {
  const byRole = {};
  const details = [];
  let total = 0;

  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    const content = extractContent(m);
    const tokens = Math.ceil(content.length / 4);
    total += tokens;
    byRole[m.role] = (byRole[m.role] || 0) + tokens;
    details.push({
      index: i,
      role: m.role,
      tokens,
      preview: content.slice(0, 80).replace(/\n/g, ' ')
    });
  }

  const largest = [...details].sort((a, b) => b.tokens - a.tokens).slice(0, 5);

  return {
    totalEstimated: total,
    byRole,
    largest,
    messageCount: messages.length,
    toolResultTokens: byRole.tool || 0,
    systemTokens: byRole.system || 0,
    assistantTokens: byRole.assistant || 0,
    userTokens: byRole.user || 0
  };
}

/**
 * Format context analysis as a human-readable summary string.
 */
export function formatContextAnalysis(analysis) {
  const roleLines = Object.entries(analysis.byRole)
    .sort(([, a], [, b]) => b - a)
    .map(([role, tokens]) => `  ${role}: ~${tokens}`)
    .join('\n');

  return [
    `total ~${analysis.totalEstimated} tokens across ${analysis.messageCount} messages`,
    roleLines,
    `largest: ${analysis.largest.map((x) => `[${x.role}#${x.index}] ~${x.tokens}`).join(', ')}`
  ].join('\n');
}

// ─── helpers ────────────────────────────────────────────────────────────────

function extractContent(m) {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((c) => (c?.type === 'text' ? c.text : JSON.stringify(c)))
      .join(' ');
  }
  if (Array.isArray(m.tool_calls)) return JSON.stringify(m.tool_calls);
  return JSON.stringify(m.content || '');
}
