import { loadRuntimeConfig } from '../core/config.js';
import { createChatCompletion } from '../core/openaiClient.js';

export async function runProbeCommand(args) {
  const cwd = process.cwd();
  const cfg = await loadRuntimeConfig(cwd);
  const modelArg = args.find((x) => !x.startsWith('-')) || '';
  const model = modelArg || cfg.model;
  const timeoutMs = Number(args.includes('--fast') ? 8000 : cfg.timeoutMs || 120000);

  const started = Date.now();
  try {
    const result = await createChatCompletion({
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model,
      temperature: 0,
      timeoutMs,
      maxRetries: 0,
      messages: [{ role: 'user', content: 'Reply with exactly: pong' }]
    });
    const latency = Date.now() - started;
    const text = String(result.text || '').trim();
    console.log('ovopre probe');
    console.log(`ok=true`);
    console.log(`model=${model}`);
    console.log(`baseURL=${cfg.baseURL}`);
    console.log(`latencyMs=${latency}`);
    console.log(`tokens=${Number(result.usage?.total_tokens || 0)}`);
    console.log(`reply=${JSON.stringify(text.slice(0, 120))}`);
  } catch (error) {
    const latency = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    console.log('ovopre probe');
    console.log('ok=false');
    console.log(`model=${model}`);
    console.log(`baseURL=${cfg.baseURL}`);
    console.log(`latencyMs=${latency}`);
    console.log(`error=${JSON.stringify(message)}`);
    throw new Error(message);
  }
}
