import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

export async function runFilesCommand(args) {
  const pathArg = args[0] || '.';
  const limit = normalizeLimit(args[1], 200);

  try {
    const { stdout } = await execFileAsync('rg', ['--files', pathArg], {
      cwd: process.cwd(),
      maxBuffer: 4 * 1024 * 1024
    });
    const lines = stdout.split('\n').map((x) => x.trim()).filter(Boolean);
    for (const line of lines.slice(0, limit)) {
      console.log(line);
    }
    return;
  } catch {
    console.log('(no files)');
  }
}

function normalizeLimit(raw, fallback) {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}
