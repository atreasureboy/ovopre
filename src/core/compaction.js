import { createChatCompletion } from './openaiClient.js';
import { analyzeContext } from '../services/contextAnalysis.js';

/**
 * Default token threshold at which compaction triggers.
 * Can be overridden via config.compactionThreshold or env OVOPRE_COMPACTION_THRESHOLD.
 */
export const DEFAULT_COMPACTION_THRESHOLD = 80000;

const COMPACTION_SYSTEM_PROMPT = [
  'You are a conversation historian for a coding AI agent.',
  'Summarize the conversation below so the agent can continue with full context.',
  '',
  'Include in your summary:',
  '- All goals and requirements the user stated',
  '- Every file created, modified, or deleted (with key changes)',
  '- Every decision made and its rationale',
  '- The current state of any ongoing work',
  '- Errors encountered and how they were resolved',
  '- All tool calls made and their outcomes (condensed)',
  '',
  'Write as a structured reference document.',
  'Be thorough but concise. Preserve all technical details.'
].join('\n');

/**
 * Check whether compaction is needed and run it if so.
 *
 * @param {Array} messages   - The full message array (including system messages)
 * @param {object} config    - Runtime config with baseURL, apiKey, model
 * @param {object} options   - { currentTokens, compactionThreshold, cwd }
 * @returns {{ messages, compacted, summary?, reason? }}
 */
export async function maybeCompact(messages, config, options = {}) {
  const envThreshold = process.env.OVOPRE_COMPACTION_THRESHOLD
    ? Number(process.env.OVOPRE_COMPACTION_THRESHOLD)
    : null;
  const threshold =
    (Number.isFinite(envThreshold) && envThreshold > 0 ? envThreshold : null) ??
    options.compactionThreshold ??
    config.compactionThreshold ??
    DEFAULT_COMPACTION_THRESHOLD;

  const currentTokens = options.currentTokens ?? 0;

  if (currentTokens < threshold) {
    return { messages, compacted: false, reason: 'below_threshold' };
  }

  const nonSystem = messages.filter((m) => m.role !== 'system');
  // Require at least a few exchanges before bothering to compact
  if (nonSystem.length < 4) {
    return { messages, compacted: false, reason: 'too_short' };
  }

  // Use contextAnalysis to include role breakdown in the compaction summary prompt
  const analysis = analyzeContext(messages);
  const analysisNote =
    `(Context breakdown — tool_results: ~${analysis.toolResultTokens} tokens, ` +
    `assistant: ~${analysis.assistantTokens} tokens, user: ~${analysis.userTokens} tokens)`;

  try {
    const summaryResult = await createChatCompletion({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      model: config.compactionModel || config.model,
      temperature: 0,
      timeoutMs: 60000,
      maxRetries: 1,
      messages: [
        { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Summarize this conversation:\n${analysisNote}\n\n${serializeMessages(nonSystem)}`
        }
      ]
    });

    const summary = (summaryResult.text || '').trim();
    if (!summary) {
      return { messages, compacted: false, reason: 'empty_summary' };
    }

    const systemMessages = messages.filter((m) => m.role === 'system');
    const compacted = [
      ...systemMessages,
      {
        role: 'user',
        content: `[Context compacted — summary of prior conversation]\n\n${summary}`
      },
      {
        role: 'assistant',
        content:
          'Understood. I have reviewed the full context summary and will continue from where we left off.'
      }
    ];

    return { messages: compacted, compacted: true, summary };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { messages, compacted: false, reason: `error: ${msg}` };
  }
}

/**
 * Rough token estimate for a message array using char-count heuristic (~4 chars/token).
 * Used when we don't have exact usage data (e.g., cross-turn estimates in interactive chat).
 */
export function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages) {
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
    chars += c.length;
  }
  return Math.ceil(chars / 4);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function serializeMessages(messages) {
  return messages
    .map((m) => {
      const role = String(m.role || 'unknown').toUpperCase();
      let body;
      if (typeof m.content === 'string') {
        body = m.content;
      } else if (Array.isArray(m.content)) {
        body = m.content
          .map((c) => (c?.type === 'text' ? c.text : JSON.stringify(c)))
          .join('\n');
      } else {
        body = JSON.stringify(m.content || '');
      }
      // Include tool_calls summary if present
      const toolCallsSummary =
        Array.isArray(m.tool_calls) && m.tool_calls.length
          ? `\n[tool_calls: ${m.tool_calls.map((tc) => tc?.function?.name || '?').join(', ')}]`
          : '';
      return `[${role}]\n${body.slice(0, 4000)}${toolCallsSummary}`;
    })
    .join('\n\n---\n\n');
}
