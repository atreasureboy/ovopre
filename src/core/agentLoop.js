import { createChatCompletion, streamChatCompletion, streamChatCompletionWithTools } from './openaiClient.js';
import { getCoreToolDefinitions, getDeferredToolDefinitions } from '../tools/catalog.js';
import { executeToolCall } from '../tools/executor.js';
import { runPreToolHooks, runPostToolHooks } from './hooks.js';
import { maybeCompact } from './compaction.js';

/**
 * Core agent completion loop.
 *
 * Key features:
 *  1. Streams every LLM round via streamChatCompletionWithTools.
 *  2. Tool calls within a single round execute in parallel (Promise.all).
 *  3. Pre/Post tool hooks fire around each tool call.
 *  4. Context compaction triggers automatically when total_tokens exceeds threshold.
 *  5. Deferred tool loading: MCP/plugin tools load on demand via tool_search.
 *  6. Worktree-aware: uses toolContext.effectiveCwd when set.
 *  7. Plan mode: executor blocks write/exec tools when toolContext.planMode = true.
 */
export async function runAgentCompletion({
  config,
  messages,
  model,
  temperature,
  timeoutMs,
  maxRetries,
  enableTools = true,
  stream = true,
  maxToolRounds = 20,
  cwd = process.cwd(),
  toolContext = {},
  onToken,
  onUsage,
  onToolCallStart,
  onToolCallEnd,
  onRoundStart,
  onCompact,
  compact: compactEnabled = true
}) {
  const targetModel = model || config.model;
  const targetTemperature = temperature ?? config.temperature ?? 0.2;
  const targetTimeoutMs = timeoutMs ?? config.timeoutMs ?? 120000;
  const targetMaxRetries = maxRetries ?? config.maxRetries ?? 2;

  // ── No-tools path (unchanged) ────────────────────────────────────────────
  if (!enableTools) {
    if (stream) {
      const streamed = await streamChatCompletion({
        baseURL: config.baseURL,
        apiKey: config.apiKey,
        model: targetModel,
        temperature: targetTemperature,
        timeoutMs: targetTimeoutMs,
        maxRetries: targetMaxRetries,
        messages,
        onToken
      });
      if (onUsage) onUsage({ delta: streamed.usage || null, aggregate: streamed.usage || null, round: 1 });
      return {
        text: streamed.text,
        message: { role: 'assistant', content: streamed.text },
        usage: streamed.usage || null
      };
    }

    const result = await createChatCompletion({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      model: targetModel,
      temperature: targetTemperature,
      timeoutMs: targetTimeoutMs,
      maxRetries: targetMaxRetries,
      messages
    });
    if (onUsage) onUsage({ delta: result.usage || null, aggregate: result.usage || null, round: 1 });
    return {
      text: result.text,
      message: result.message || { role: 'assistant', content: result.text },
      usage: result.usage || null
    };
  }

  // ── Agentic tool loop ────────────────────────────────────────────────────

  // Core tools are always present; deferred tools start empty and grow via tool_search.
  const coreToolDefs = getCoreToolDefinitions();
  const deferredDefs = await getDeferredToolDefinitions(cwd);

  // dynamicTools: schemas discovered this session via tool_search (shared ref with toolContext)
  const dynamicTools = toolContext.dynamicTools instanceof Map
    ? toolContext.dynamicTools
    : new Map();

  // Wire deferred definitions + dynamic map into toolContext so the executor can use them
  toolContext.dynamicTools = dynamicTools;
  toolContext.deferredDefinitions = deferredDefs;

  const loopMessages = [...messages];
  let totalToolCalls = 0;
  let aggregateUsage = emptyUsage();
  let repeatedPermissionFailureRounds = 0;
  let lastPermissionSignature = '';

  const compactionThreshold = config.compactionThreshold || 80000;

  for (let i = 0; i < maxToolRounds; i += 1) {
    const round = i + 1;

    // ── 1. Compact if previous round pushed us over threshold ──────────────
    if (compactEnabled && i > 0 && aggregateUsage.total_tokens >= compactionThreshold) {
      const compactResult = await maybeCompact(loopMessages, config, {
        currentTokens: aggregateUsage.total_tokens,
        compactionThreshold,
        cwd
      });
      if (compactResult.compacted) {
        loopMessages.length = 0;
        loopMessages.push(...compactResult.messages);
        aggregateUsage = emptyUsage();
        if (onCompact) onCompact({ round, summary: compactResult.summary });
      }
    }

    if (onRoundStart) onRoundStart(round);

    // ── 2. Build active tool list: core + dynamically discovered ──────────
    const activeTools = buildActiveToolList(coreToolDefs, dynamicTools);

    // ── 3. Stream LLM response (text tokens + reconstruct tool_calls) ─────
    const streamResult = await streamChatCompletionWithTools({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      model: targetModel,
      temperature: targetTemperature,
      timeoutMs: targetTimeoutMs,
      maxRetries: targetMaxRetries,
      messages: loopMessages,
      tools: activeTools,
      onToken
    });

    aggregateUsage = mergeUsage(aggregateUsage, streamResult.usage);
    if (onUsage) onUsage({ delta: streamResult.usage || null, aggregate: aggregateUsage, round });

    loopMessages.push(streamResult.message);

    const toolCalls = streamResult.toolCalls || [];

    // ── 4. No tool calls → done ────────────────────────────────────────────
    if (!toolCalls.length) {
      return {
        text: streamResult.text || '',
        message: streamResult.message,
        messages: loopMessages,
        usage: aggregateUsage,
        toolCalls: totalToolCalls
      };
    }

    // ── 5. Execute tool calls in parallel ─────────────────────────────────
    const roundBase = totalToolCalls;

    const execResults = await Promise.all(
      toolCalls.map(async (call, callIdx) => {
        const toolName = call?.function?.name || 'unknown';
        const callIndex = roundBase + callIdx + 1;
        const rawArgs = call?.function?.arguments || '{}';
        let parsedArgs;
        try { parsedArgs = JSON.parse(rawArgs); } catch { parsedArgs = {}; }

        if (onToolCallStart) {
          onToolCallStart({ index: callIndex, name: toolName, call, parsedArgs, round });
        }

        // Pre-hook (may block the tool)
        const { blocked, reason } = await runPreToolHooks(toolName, parsedArgs, cwd);
        if (blocked) {
          const blockedResult = {
            ok: false,
            output: reason || `Tool "${toolName}" blocked by preToolCall hook`,
            meta: { blocked: true }
          };
          if (onToolCallEnd) {
            onToolCallEnd({ index: callIndex, name: toolName, call, round, ok: false, durationMs: 0,
              output: blockedResult.output, meta: blockedResult.meta });
          }
          if (!onToolCallStart && !onToolCallEnd) {
            console.log(`tool> ${toolName} (blocked)`);
          }
          return { call, callIndex, toolResult: blockedResult };
        }

        // Use worktree cwd if active, otherwise the original cwd
        const effectiveCwd = toolContext.effectiveCwd || cwd;

        const startedAt = Date.now();
        const toolResult = await executeToolCall(call, {
          ...toolContext,
          cwd: effectiveCwd
        });
        const durationMs = Date.now() - startedAt;

        // Post-hook (fire-and-forget)
        runPostToolHooks(toolName, toolResult, cwd);

        if (onToolCallEnd) {
          onToolCallEnd({ index: callIndex, name: toolName, call, round, ok: toolResult.ok,
            durationMs, output: toolResult.output, meta: toolResult.meta || null });
        }
        if (!onToolCallStart && !onToolCallEnd) {
          console.log(`tool> ${toolName} (${toolResult.ok ? 'ok' : 'error'})`);
        }

        return { call, callIndex, toolResult };
      })
    );

    totalToolCalls += toolCalls.length;

    // ── 6. Push tool results in call-index order ──────────────────────────
    const sorted = execResults.sort((a, b) => a.callIndex - b.callIndex);
    for (const { call, toolResult } of sorted) {
      loopMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({
          ok: toolResult.ok,
          output: toolResult.output,
          meta: toolResult.meta || null
        })
      });
    }

    const permissionSignal = summarizePermissionFailure(sorted);
    if (permissionSignal.allPermissionDenied) {
      if (permissionSignal.signature === lastPermissionSignature) {
        repeatedPermissionFailureRounds += 1;
      } else {
        lastPermissionSignature = permissionSignal.signature;
        repeatedPermissionFailureRounds = 1;
      }

      if (repeatedPermissionFailureRounds >= 2) {
        throw new Error(
          [
            'Repeated filesystem permission failures while executing tools.',
            `Likely blocked path: ${permissionSignal.pathHint || 'unknown'}.`,
            'If this path is read-only (for example /project), choose a writable path such as the current repository directory.'
          ].join(' ')
        );
      }
    } else {
      repeatedPermissionFailureRounds = 0;
      lastPermissionSignature = '';
    }
  }

  throw new Error('Tool loop exceeded max rounds');
}

// ─── helpers ────────────────────────────────────────────────────────────────

function buildActiveToolList(coreToolDefs, dynamicTools) {
  if (!dynamicTools.size) return coreToolDefs;

  const seen = new Set(coreToolDefs.map((d) => d?.function?.name).filter(Boolean));
  const extra = [];
  for (const [name, def] of dynamicTools) {
    if (!seen.has(name)) {
      extra.push(def);
      seen.add(name);
    }
  }
  return extra.length ? [...coreToolDefs, ...extra] : coreToolDefs;
}

export function emptyUsage() {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

export function mergeUsage(base, extra) {
  const b = base || emptyUsage();
  if (!extra) return b;
  return {
    prompt_tokens: Number(b.prompt_tokens || 0) + Number(extra.prompt_tokens || 0),
    completion_tokens: Number(b.completion_tokens || 0) + Number(extra.completion_tokens || 0),
    total_tokens: Number(b.total_tokens || 0) + Number(extra.total_tokens || 0)
  };
}

function summarizePermissionFailure(execResults) {
  if (!Array.isArray(execResults) || !execResults.length) {
    return { allPermissionDenied: false, signature: '', pathHint: '' };
  }

  const failed = execResults.filter((item) => !item?.toolResult?.ok);
  if (!failed.length || failed.length !== execResults.length) {
    return { allPermissionDenied: false, signature: '', pathHint: '' };
  }

  const extracted = failed
    .map((item) => {
      const output = String(item?.toolResult?.output || '');
      const lower = output.toLowerCase();
      const isPermission =
        lower.includes('eacces') ||
        lower.includes('eperm') ||
        lower.includes('erofs') ||
        lower.includes('permission denied') ||
        lower.includes('read-only file system');
      if (!isPermission) return null;
      return {
        toolName: String(item?.call?.function?.name || ''),
        pathHint: extractPathHint(output)
      };
    })
    .filter(Boolean);

  if (extracted.length !== failed.length) {
    return { allPermissionDenied: false, signature: '', pathHint: '' };
  }

  const signature = extracted
    .map((x) => `${x.toolName}:${x.pathHint || '?'}`)
    .sort()
    .join('|');

  const firstPath = extracted.find((x) => x.pathHint)?.pathHint || '';
  return {
    allPermissionDenied: true,
    signature,
    pathHint: firstPath
  };
}

function extractPathHint(text) {
  const source = String(text || '');
  const absPathMatch = source.match(/(\/[^\s:'"]+)/);
  return absPathMatch ? absPathMatch[1] : '';
}
