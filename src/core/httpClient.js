/**
 * Shared HTTP utilities: retry logic, backoff, and base-URL normalization.
 * Used by openaiClient.js and modelsRegistry.js to avoid duplication.
 */

export function backoffMs(attempt) {
  return Math.min(8000, 500 * (2 ** attempt));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeBaseURL(baseURL) {
  const s = String(baseURL || '');
  const trimmed = s.endsWith('/') ? s.slice(0, -1) : s;
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/**
 * Fetch with exponential-backoff retries.
 * Retries on 429 and 5xx. Throws on timeout, network error, or non-retryable HTTP error.
 *
 * @param {string} url
 * @param {{ method?, headers?, body?, timeoutMs, maxRetries }} opts
 *   body is JSON-serialized automatically when provided.
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, { method = 'GET', headers = {}, body, timeoutMs, maxRetries }) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      clearTimeout(timer);

      if (response.ok) return response;

      const text = await response.text();
      const err = new Error(`API ${response.status}: ${text}`);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxRetries) throw err;

      lastError = err;
      await sleep(backoffMs(attempt));
    } catch (error) {
      clearTimeout(timer);
      const isAbort = error?.name === 'AbortError';
      const message = error instanceof Error ? error.message : String(error);
      const wrapped = new Error(
        isAbort
          ? `Request timeout after ${timeoutMs}ms calling ${url}`
          : `Network error calling ${url}: ${message}`
      );
      if (attempt === maxRetries) throw wrapped;
      lastError = wrapped;
      await sleep(backoffMs(attempt));
    }
  }

  throw lastError || new Error('Unknown API request failure');
}
