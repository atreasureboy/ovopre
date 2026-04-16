import { parseArgs, hasFlag, getFlagValue } from './utils/args.js';
import { parsePositiveInt, parseNonNegativeInt } from './core/config.js';
import { runConfigCommand } from './commands/config.js';
import { runInteractiveChat, runOneShot, runTask } from './commands/chat.js';
import { runSessionCommand } from './commands/session.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runSkillsCommand } from './commands/skills.js';
import { runPluginsCommand } from './commands/plugins.js';
import { runMcpCommand } from './commands/mcp.js';
import { runTraceCommand } from './commands/trace.js';
import { runStatsCommand } from './commands/stats.js';
import { runCommandsCommand } from './commands/commands.js';
import { runModelCommand } from './commands/model.js';
import { runToolsCommand } from './commands/tools.js';
import { runCostCommand } from './commands/cost.js';
import { runReportCommand } from './commands/report.js';
import { runVersionCommand } from './commands/version.js';
import { runStatusCommand } from './commands/status.js';
import { runFilesCommand } from './commands/files.js';
import { runDiffCommand } from './commands/diff.js';
import { runLogsCommand } from './commands/logs.js';
import { runExportCommand } from './commands/export.js';
import { runImportCommand } from './commands/import.js';
import { runProbeCommand } from './commands/probe.js';
import { runModelsCommand } from './commands/models.js';
import { runTasksCommand, runTasksExecCommand } from './commands/tasks.js';
import { readStdinIfPiped } from './utils/stdin.js';

const HELP_TEXT = `ovopre - OpenAI-compatible coding CLI (scaffold)

Usage:
  ovopre
  ovopre "your prompt" [--model <model>] [--temperature <0-2>] [--timeout-ms <n>] [--max-retries <n>] [--no-tools] [--no-stream] [--verbose-ui]
  ovopre chat [--model <model>] [--temperature <0-2>] [--session <id>] [--no-history] [--timeout-ms <n>] [--max-retries <n>] [--no-tools] [--no-stream] [--verbose-ui] [--plan-preview]
  ovopre task "goal" [--model <model>] [--temperature <0-2>] [--max-tool-rounds <n>] [--max-task-retries <n>] [--verify-rounds <n>] [--auto-rollback-on-fail] [--timeout-ms <n>] [--max-retries <n>] [--no-tools]
  ovopre config show
  ovopre config init --api-key <key> [--base-url <url>] [--model <model>] [--temperature <0-2>] [--timeout-ms <n>] [--max-retries <n>]
  ovopre config set <apiKey|baseURL|model|temperature|timeoutMs|maxRetries> <value>
  ovopre model [show|set <model>|<model>]
  ovopre tools
  ovopre status
  ovopre files [path] [limit]
  ovopre diff [--staged] [path]
  ovopre logs [list|show <latest|taskId|file>]
  ovopre export [out.json]
  ovopre import <export.json>
  ovopre probe [model] [--fast]
  ovopre models [list|refresh|use <model-id>|where] [--json] [--limit=N]
  ovopre skills list|init-sample
  ovopre plugins list|init-sample|install|update|rm|reload
  ovopre tasks [list|show <id>|cancel <id>|run <goal>]
  ovopre mcp list|add|rm|tools|health|runtime|reset
  ovopre trace list|show
  ovopre stats [days]|trend [days]|model [days]|task-type [days]|failure [days]|export [days] [json|csv] [out]
  ovopre cost [days]
  ovopre report [days]
  ovopre session list|show|rm ...
  ovopre doctor
  ovopre commands
  ovopre help
  ovopre version

Env vars:
  OVOPRE_HOME
  OPENAI_API_KEY
  OVOPRE_API_KEY
  OVOGO_API_KEY
  DEEPSEEK_API_KEY
  OPENAI_BASE_URL
  OPENAI_API_BASE
  OVOPRE_BASE_URL
  OVOGO_BASE_URL
  OPENAI_MODEL
  OVOPRE_MODEL
  OVOGO_MODEL
  DEEPSEEK_MODEL
  OVOGO_DEFAULT_MODEL
  OPENAI_TEMPERATURE
  OVOPRE_TEMPERATURE
  OVOGO_TEMPERATURE
  OPENAI_TIMEOUT_MS
  OVOPRE_TIMEOUT_MS
  OVOGO_TIMEOUT_MS
  OPENAI_MAX_RETRIES
  OVOPRE_MAX_RETRIES
  OVOGO_MAX_RETRIES
  OVOPRE_PRICE_INPUT_PER_1M
  OVOPRE_PRICE_OUTPUT_PER_1M
  DEEPSEEK_MODEL_TEMPERATURE

Examples:
  ovopre
  ovopre config init --api-key sk-xxx --base-url https://api.openai.com/v1 --model gpt-4.1-mini
  ovopre "帮我为 Node CLI 设计项目结构"
  cat TODO.md | ovopre
  ovopre skills init-sample
  ovopre plugins init-sample
  ovopre tools
  ovopre status
  ovopre files src 100
  ovopre diff --staged
  ovopre logs show latest
  ovopre export /tmp/ovopre_export.json
  ovopre import /tmp/ovopre_export.json
  ovopre probe
  ovopre probe deepseek-reasoner --fast
  ovopre models
  ovopre models refresh
  ovopre models use deepseek-reasoner
  ovopre plugins install /path/to/my-plugin.mjs
  ovopre plugins reload
  ovopre tasks run "为当前仓库补齐 README 并运行测试"
  ovopre tasks list
  ovopre tasks show t_20260101_abcd12
  ovopre tasks cancel t_20260101_abcd12
  ovopre trace list
  ovopre stats 7
  ovopre stats model 30
  ovopre stats export 30 csv /tmp/ovopre_cost.csv
  ovopre report 7
  ovopre chat --session coding
  ovopre session list
  ovopre task "为当前仓库补齐 README 并运行测试"
`;

export async function runCli(argv) {
  const { flags, positionals } = parseArgs(argv);
  const cmd = positionals[0];

  if (hasFlag(flags, '--help', '-h')) {
    console.log(HELP_TEXT);
    return;
  }

  if (hasFlag(flags, '--version', '-v')) {
    await runVersionCommand();
    return;
  }

  if (cmd === 'config') {
    await runConfigCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'model') {
    await runModelCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'tools') {
    await runToolsCommand();
    return;
  }
  if (cmd === 'status') {
    await runStatusCommand();
    return;
  }
  if (cmd === 'files') {
    await runFilesCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'diff') {
    await runDiffCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'logs') {
    await runLogsCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'export') {
    await runExportCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'import') {
    await runImportCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'probe') {
    await runProbeCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'models') {
    await runModelsCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'skills') {
    await runSkillsCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'plugins') {
    await runPluginsCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'tasks') {
    const taskOpts = {
      model: getFlagValue(flags, '--model'),
      temperature: parseOptionalNumber(getFlagValue(flags, '--temperature')),
      timeoutMs: normalizePositiveInt(getFlagValue(flags, '--timeout-ms'), undefined),
      maxRetries: normalizeNonNegativeInt(getFlagValue(flags, '--max-retries'), undefined),
      maxTaskRetries: normalizeNonNegativeInt(getFlagValue(flags, '--max-task-retries'), 2),
      verifyRounds: normalizeNonNegativeInt(getFlagValue(flags, '--verify-rounds'), 2),
      autoRollbackOnFail: hasFlag(flags, '--auto-rollback-on-fail'),
      maxToolRounds: normalizePositiveInt(getFlagValue(flags, '--max-tool-rounds'), 20)
    };
    await runTasksCommand(positionals.slice(1), taskOpts);
    return;
  }
  if (cmd === 'tasks-exec') {
    await runTasksExecCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'mcp') {
    await runMcpCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'trace') {
    await runTraceCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'stats') {
    await runStatsCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'cost') {
    await runCostCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'report') {
    await runReportCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'session') {
    await runSessionCommand(positionals.slice(1));
    return;
  }
  if (cmd === 'doctor') {
    await runDoctorCommand();
    return;
  }
  if (cmd === 'commands') {
    await runCommandsCommand();
    return;
  }
  if (cmd === 'help') {
    console.log(HELP_TEXT);
    return;
  }
  if (cmd === 'version') {
    await runVersionCommand();
    return;
  }

  const commonOptions = {
    model: getFlagValue(flags, '--model'),
    temperature: parseOptionalNumber(getFlagValue(flags, '--temperature')),
    timeoutMs: normalizePositiveInt(getFlagValue(flags, '--timeout-ms'), undefined),
    maxRetries: normalizeNonNegativeInt(getFlagValue(flags, '--max-retries'), undefined),
    maxTaskRetries: normalizeNonNegativeInt(getFlagValue(flags, '--max-task-retries'), 2),
    verifyRounds: normalizeNonNegativeInt(getFlagValue(flags, '--verify-rounds'), 2),
    autoRollbackOnFail: hasFlag(flags, '--auto-rollback-on-fail'),
    sessionId: getFlagValue(flags, '--session'),
    systemPrompt: getFlagValue(flags, '--system'),
    noHistory: hasFlag(flags, '--no-history'),
    enableTools: !hasFlag(flags, '--no-tools'),
    stream: !hasFlag(flags, '--no-stream'),
    verboseUi: hasFlag(flags, '--verbose-ui'),
    planPreview: hasFlag(flags, '--plan-preview'),
    cwd: getFlagValue(flags, '--cwd') || process.cwd(),
    maxToolRounds: normalizePositiveInt(getFlagValue(flags, '--max-tool-rounds'), 20),
    output: getFlagValue(flags, '--output') || undefined
  };

  if (cmd === 'chat') {
    const result = await runInteractiveChat(commonOptions);
    if (result?.exitRequested) {
      process.exit(0);
    }
    return;
  }

  if (cmd === 'task') {
    const goal = positionals.slice(1).join(' ').trim();
    if (!goal) {
      throw new Error('Usage: ovopre task \"your goal\"');
    }
    await runTask(goal, commonOptions);
    return;
  }

  const prompt = positionals.join(' ').trim() || (await readStdinIfPiped());
  if (prompt) {
    await runOneShot(prompt, commonOptions);
    return;
  }

  if (!cmd) {
    const result = await runInteractiveChat(commonOptions);
    if (result?.exitRequested) {
      process.exit(0);
    }
    return;
  }

  console.log(HELP_TEXT);
}

// Wrappers that return `fallback` instead of undefined, delegating validation to config parsers.
const normalizePositiveInt = (raw, fallback) => parsePositiveInt(raw) ?? fallback;
const normalizeNonNegativeInt = (raw, fallback) => parseNonNegativeInt(raw) ?? fallback;

function parseOptionalNumber(raw) {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
