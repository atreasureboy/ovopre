import { loadFileConfig, loadRuntimeConfig, redactConfig, saveFileConfig } from '../core/config.js';

export async function runConfigCommand(args) {
  const [action, ...rest] = args;
  const cwd = process.cwd();

  if (!action || action === 'show') {
    const runtime = await loadRuntimeConfig(cwd);
    console.log(JSON.stringify(redactConfig(runtime), null, 2));
    return;
  }

  if (action === 'init') {
    const patch = parseKeyValues(rest);
    if (!Object.keys(patch).length) {
      throw new Error('Usage: ovopre config init --api-key <key> [--base-url <url>] [--model <model>] [--temperature <0-2>] [--timeout-ms <n>] [--max-retries <n>]');
    }

    const saved = await saveFileConfig({
      apiKey: patch.apiKey,
      baseURL: patch.baseURL,
      model: patch.model,
      temperature: patch.temperature,
      timeoutMs: patch.timeoutMs,
      maxRetries: patch.maxRetries
    }, cwd);

    console.log('Saved config:');
    console.log(JSON.stringify(redactConfig(saved), null, 2));
    return;
  }

  if (action === 'set') {
    if (rest.length < 2) {
      throw new Error('Usage: ovopre config set <apiKey|baseURL|model|temperature|timeoutMs|maxRetries> <value>');
    }
    const [key, ...valueParts] = rest;
    const value = valueParts.join(' ').trim();
    if (!['apiKey', 'baseURL', 'model', 'temperature', 'timeoutMs', 'maxRetries'].includes(key)) {
      throw new Error('Only support keys: apiKey, baseURL, model, temperature, timeoutMs, maxRetries');
    }

    const saved = await saveFileConfig({ [key]: value }, cwd);
    console.log('Updated config:');
    console.log(JSON.stringify(redactConfig(saved), null, 2));
    return;
  }

  if (action === 'raw') {
    const file = await loadFileConfig(cwd);
    console.log(JSON.stringify(file, null, 2));
    return;
  }

  throw new Error(`Unknown config action: ${action}`);
}

function parseKeyValues(tokens) {
  const out = {};

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = tokens[i + 1];
    if (!next) {
      continue;
    }

    if (token === '--api-key') {
      out.apiKey = next;
      i += 1;
    } else if (token === '--base-url') {
      out.baseURL = next;
      i += 1;
    } else if (token === '--model') {
      out.model = next;
      i += 1;
    } else if (token === '--temperature') {
      out.temperature = next;
      i += 1;
    } else if (token === '--timeout-ms') {
      out.timeoutMs = next;
      i += 1;
    } else if (token === '--max-retries') {
      out.maxRetries = next;
      i += 1;
    }
  }

  return out;
}
