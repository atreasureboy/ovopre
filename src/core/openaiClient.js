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
  if (!apiKey) {
    throw new Error('Missing API key. Set OPENAI_API_KEY or run: ovopre config init --api-key <key>');
  }

  const url = normalizeBaseURL(baseURL) + '/chat/completions';
  const response = await requestWithRetry(url, {
    apiKey,
    timeoutMs,
    maxRetries,
    body: {
      model,
      messages,
      temperature,
      tools,
      tool_choice: toolChoice
    }
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
  if (!apiKey) {
    throw new Error('Missing API key. Set OPENAI_API_KEY or run: ovopre config init --api-key <key>');
  }

  const url = normalizeBaseURL(baseURL) + '/chat/completions';
  const response = await requestWithRetry(url, {
    apiKey,
    timeoutMs,
    maxRetries,
    body: {
      model,
      messages,
      temperature,
      tools: tools?.length ? tools : undefined,
      tool_choice: toolChoice,
      stream: true
    }
  });

  if (!response.body) throw new Error('Missing response stream body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let usage = null;
  let finishReason = null;
  // Accumulate tool_calls deltas keyed by their index field
  const toolCallsMap = new Map();
  let streamDone = false;

  while (!streamDone) {
    const chunk = await reader.read();
    if (chunk.done) break;

    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') { streamDone = true; break; }

      let payload;
      try { payload = JSON.parse(data); } catch { continue; }

      if (payload?.usage) usage = payload.usage;

      const choice = payload?.choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta;
      if (!delta) continue;

      // Accumulate text content
      if (delta.content) {
        fullText += delta.content;
        if (onToken) onToken(delta.content);
      }

      // Accumulate tool_calls by their index
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, {
              id: '',
              type: 'function',
              function: { name: '', arguments: '' }
            });
          }
          const entry = toolCallsMap.get(idx);
          if (tc.id) entry.id = tc.id;
          if (tc.type) entry.type = tc.type;
          if (tc.function?.name) entry.function.name += tc.function.name;
          if (tc.function?.arguments) entry.function.arguments += tc.function.arguments;
        }
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
  if (!apiKey) {
    throw new Error('Missing API key. Set OPENAI_API_KEY or run: ovopre config init --api-key <key>');
  }

  const url = normalizeBaseURL(baseURL) + '/chat/completions';
  const response = await requestWithRetry(url, {
    apiKey,
    timeoutMs,
    maxRetries,
    body: {
      model,
      messages,
      temperature,
      stream: true
    }
  });

  if (!response.body) {
    throw new Error('Missing response stream body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  let buffer = '';
  let fullText = '';
  let usage = null;

  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    if (done) {
      break;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) {
        continue;
      }

      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') {
        return { text: fullText, usage };
      }

      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }

      if (payload?.usage) {
        usage = payload.usage;
      }
      const token = payload?.choices?.[0]?.delta?.content;
      if (!token) {
        continue;
      }
      fullText += token;
      if (onToken) {
        onToken(token);
      }
    }
  }

  return { text: fullText, usage };
}

async function requestWithRetry(url, { apiKey, body, timeoutMs, maxRetries }) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (response.ok) {
        return response;
      }

      const text = await response.text();
      const err = new Error(`API ${response.status}: ${text}`);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxRetries) {
        throw err;
      }

      lastError = err;
      await sleep(backoffMs(attempt));
      continue;
    } catch (error) {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : String(error);
      const isAbort = error && typeof error === 'object' && 'name' in error && error.name === 'AbortError';
      const wrapped = new Error(
        isAbort
          ? `Request timeout after ${timeoutMs}ms calling ${url}`
          : `Network error calling ${url}: ${message}`
      );

      if (attempt === maxRetries) {
        throw wrapped;
      }
      lastError = wrapped;
      await sleep(backoffMs(attempt));
    }
  }

  throw lastError || new Error('Unknown API request failure');
}

function backoffMs(attempt) {
  return Math.min(8000, 500 * (2 ** attempt));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseURL(baseURL) {
  const normalized = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
}
