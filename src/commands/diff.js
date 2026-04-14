import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

export async function runDiffCommand(args) {
  const staged = args.includes('--staged');
  const pathArg = args.find((x) => !x.startsWith('-'));

  const inGitRepo = await isGitRepository();
  if (!inGitRepo) {
    console.log('(not a git repository)');
    return;
  }

  const diffArgs = ['diff'];
  if (staged) diffArgs.push('--cached');
  if (pathArg) diffArgs.push('--', pathArg);

  try {
    const { stdout, stderr } = await execFileAsync('git', diffArgs, {
      cwd: process.cwd(),
      maxBuffer: 4 * 1024 * 1024
    });
    const text = [stdout, stderr].filter(Boolean).join('\n').trim();
    console.log(text || '(no diff)');
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout || '') : '';
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr || '') : '';
    const text = [stdout, stderr].filter(Boolean).join('\n').trim();
    console.log(text || '(not a git repository)');
  }
}

async function isGitRepository() {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 64
    });
    return String(stdout || '').trim() === 'true';
  } catch {
    return false;
  }
}
