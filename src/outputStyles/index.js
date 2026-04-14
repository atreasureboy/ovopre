/**
 * Output style system.
 *
 * Modes:
 *   terminal  – ANSI colors, banners, status bars (default when stdout is a TTY)
 *   plain     – no ANSI, just text (default when piped)
 *   json      – machine-readable JSON on stdout
 *
 * Usage:
 *   const fmt = createFormatter(options.output);
 *   fmt.result(text, usage);
 *   fmt.taskResult(ok, summary, usage);
 */

export function createFormatter(mode) {
  // Auto-detect: use plain when piped, terminal when TTY
  const effective = mode || (process.stdout.isTTY ? 'terminal' : 'plain');
  const valid = ['terminal', 'plain', 'json'];
  const resolved = valid.includes(effective) ? effective : 'terminal';

  return {
    mode: resolved,
    isTerminal: resolved === 'terminal',
    isJson: resolved === 'json',
    isPlain: resolved === 'plain',

    /**
     * Emit a one-shot prompt result.
     */
    result(text, usage) {
      const body = (text || '').trimEnd();
      if (resolved === 'json') {
        process.stdout.write(
          JSON.stringify({ ok: true, text: body, usage: usage || null }) + '\n'
        );
      } else {
        // terminal + plain: raw text (caller handles ANSI prefix in streaming mode)
        process.stdout.write(body + '\n');
      }
    },

    /**
     * Emit a task result.
     */
    taskResult(ok, summary, usage) {
      const body = (summary || '').trimEnd();
      if (resolved === 'json') {
        process.stdout.write(
          JSON.stringify({ ok, summary: body, usage: usage || null }) + '\n'
        );
      } else {
        process.stdout.write(body + '\n');
      }
    },

    /**
     * Emit an error.
     */
    error(message) {
      const body = String(message || '');
      if (resolved === 'json') {
        process.stdout.write(
          JSON.stringify({ ok: false, error: body }) + '\n'
        );
      } else {
        process.stderr.write(`error: ${body}\n`);
      }
    }
  };
}
