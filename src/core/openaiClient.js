import { fetchWithRetry, normalizeBaseURL } from './httpClient.js';

const API_KEY_ERROR = 'Missing API key. Set OPENAI_API_KEY or run: ovopre config init --api-key <key>';

function jsonHeaders(apiKey) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
}

export async function createChatCompletion({
  baseURL,
  apiKey,
  model,
  messages,
  temperature = 0.2,
  tools,
  toolChoice,
  timeoutMs = 120000,
  maxRetries = 2
}) {
  if (!apiKey) throw new Error(API_KEY_ERROR);

  const url = normalizeBaseURL(baseURL) + '/chat/completions';
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: jsonHeaders(apiKey),
    body: { model, messages, temperature, tools, tool_choice: toolChoice },
    timeoutMs,
    maxRetries
  });

  const payload = await response.json();
  const message = payload?.choices?.[0]?.message;
  const content = message?.content;

  return {
    text: content ? (typeof content === 'string' ? content : JSON.stringify(content)) : '',
    message,
    usage: payload?.usage || null,
    raw: payload
  };
}

/**
 * Stream a chat completion that may include tool calls.
 * Reconstructs incremental tool_call deltas into complete tool_calls objects.
 *
 * Returns: { text, message, toolCalls, usage, finishReason }
 *   - text:        accumulated text content (may be empty when finish_reason=tool_calls)
 *   - message:     full assistant message object ready to push into history
 *   - toolCalls:   reconstructed tool_calls array (empty when no tools invoked)
 *   - usage:       token usage if the provider emits it in the stream
 *   - finishReason: 'stop' | 'tool_calls' | null
 */
export async function streamChatCompletionWithTools({
  baseURL,
  apiKey,
  model,
  messages,
  temperature = 0.2,
  tools,
  toolChoice,
  timeoutMs = 120000,
  maxRetries = 2,
  onToken
}) {
  if (!apiKey) throw new Error(API_KEY_ERROR);

  const url = normalizeBaseURL(baseURL) + '/chat/completions';
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: jsonHeaders(apiKey),
    body: {
      model,
      messages,
      temperature,
      tools: tools?.length ? tools : undefined,
      tool_choice: toolChoice,
      stream: true
    },
    timeoutMs,
    maxRetries
  });

  let fullText = '';
  let usage = null;
  let finishReason = null;
  const toolCallsMap = new Map();

  for await (const payload of readSSE(response)) {
    if (payload.usage) usage = payload.usage;

    const choice = payload?.choices?.[0];
    if (!choice) continue;

    if (choice.finish_reason) finishReason = choice.finish_reason;

    const delta = choice.delta;
    if (!delta) continue;

    if (delta.content) {
      fullText += delta.content;
      if (onToken) onToken(delta.content);
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallsMap.has(idx)) {
          toolCallsMap.set(idx, { id: '', type: 'function', function: { name: '', arguments: '' } });
        }
        const entry = toolCallsMap.get(idx);
        if (tc.id) entry.id = tc.id;
        if (tc.type) entry.type = tc.type;
        if (tc.function?.name) entry.function.name += tc.function.name;
        if (tc.function?.arguments) entry.function.arguments += tc.function.arguments;
      }
    }
  }

  const toolCalls = [...toolCallsMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => tc);

  const message = {
    role: 'assistant',
    content: fullText || null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {})
  };

  return { text: fullText, message, toolCalls, usage, finishReason };
}

export async function streamChatCompletion({
  baseURL,
  apiKey,
  model,
  messages,
  temperature = 0.2,
  timeoutMs = 120000,
  maxRetries = 2,
  onToken
}) {
  if (!apiKey) throw new Error(API_KEY_ERROR);

  const url = normalizeBaseURL(baseURL) + '/chat/completions';
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: jsonHeaders(apiKey),
    body: { model, messages, temperature, stream: true },
    timeoutMs,
    maxRetries
  });

  let fullText = '';
  let usage = null;

  for await (const payload of readSSE(response)) {
    if (payload.usage) usage = payload.usage;
    const token = payload?.choices?.[0]?.delta?.content;
    if (!token) continue;
    fullText += token;
    if (onToken) onToken(token);
  }

  return { text: fullText, usage };
}

// ─── SSE stream parser ────────────────────────────────────────────────────────

/**
 * Async generator that yields parsed JSON payloads from a server-sent events response.
 * Terminates on [DONE] or when the stream closes.
 */
async function* readSSE(response) {
  if (!response.body) throw new Error('Missing response stream body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;
        try { yield JSON.parse(data); } catch { /* skip malformed chunks */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
