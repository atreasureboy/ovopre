import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadRuntimeConfig } from '../core/config.js';
import { loadSession, saveSession } from '../core/sessionStore.js';
import { runAgentCompletion, mergeUsage } from '../core/agentLoop.js';
import { maybeCompact } from '../core/compaction.js';
import { extractAndSaveMemory, loadMemoriesForPrompt } from '../services/memoryExtractor.js';
import { createFormatter } from '../outputStyles/index.js';
import { runTaskStateMachine } from '../core/taskRunner.js';
import { buildSkillsSystemAddendum } from '../skills/loader.js';
import { resetMcpRuntime } from '../mcp/runtime.js';
import { runModelsCommand } from './models.js';
import { runStatusCommand } from './status.js';
import { runCostCommand } from './cost.js';
import { runSessionCommand } from './session.js';
import { runPluginsCommand } from './plugins.js';
import { runSkillsCommand } from './skills.js';
import { runMcpCommand } from './mcp.js';
import { runTasksCommand } from './tasks.js';
import {
  extractPrimaryArg,
  formatAssistant,
  formatAssistantHeader,
  formatInfo,
  formatStatusBar,
  formatSuccess,
  formatToolEnd,
  formatToolLine,
  formatToolStart,
  formatWarn,
  promptUser,
  renderBanner,
  renderInputBox,
} from '../ui/terminal.js';

// ─── Public commands ──────────────────────────────────────────────────────────

export async function runOneShot(prompt, options = {}) {
  const config = await loadRuntimeConfig(options.cwd);
  const fmt = createFormatter(options.output);
  const messages = await buildBaseMessages(options.systemPrompt, options.mode || 'chat', options.cwd);
  messages.push({ role: 'user', content: prompt });

  const { result, hadStreamOutput } = await runAgentTurn(messages, config, options, {
    isTerminal: fmt.isTerminal,
    verboseUi: Boolean(options.verboseUi),
  });

  if (!hadStreamOutput) {
    fmt.result((result.text || '').trim(), result.usage);
  }
}

export async function runTask(goal, options = {}) {
  const config = await loadRuntimeConfig(options.cwd);
  const fmt = createFormatter(options.output);
  const state = { usage: null, toolCalls: 0, round: null };
  const model = options.model || config.model;
  const toolArgMap = new Map();

  const result = await runTaskStateMachine({
    goal,
    config,
    options: {
      ...options,
      mode: 'task',
      enableTools: options.enableTools !== false,
      quiet: true,
      onStage: ({ stage, attempt, totalAttempts, failureCategory }) => {
        if (fmt.isJson) return;
        if (stage === 'plan') {
          console.log(formatInfo('∙ planning'));
        } else if (stage === 'retry') {
          console.log(formatInfo(`∙ retrying (${attempt}/${totalAttempts})${failureCategory ? `  ${failureCategory}` : ''}`));
        }
      },
      onRoundStart: (round) => { state.round = round; },
      onUsage: ({ delta, aggregate, round }) => {
        state.usage = mergeUsage(state.usage, delta || aggregate);
        state.round = round || state.round;
      },
      onToolCallStart: ({ index, name, parsedArgs = {} }) => {
        state.toolCalls = index;
        toolArgMap.set(index, extractPrimaryArg(name, parsedArgs));
      },
      onToolCallEnd: ({ name, ok, durationMs, index }) => {
        if (!isInternalTool(name)) {
          console.log(formatToolLine(name, ok, durationMs, toolArgMap.get(index) || ''));
        }
      },
      onProgress: printTaskProgress,
    },
  });
  fmt.taskResult(result.ok, result.summary, state.usage);
}

export async function runInteractiveChat(options = {}) {
  const config = await loadRuntimeConfig(options.cwd);
  const sessionId = options.sessionId || 'default';
  const messages = [
    ...(await buildBaseMessages(options.systemPrompt, 'chat', options.cwd)),
    ...(options.noHistory ? [] : await loadSession(sessionId)),
  ];

  const rl = readline.createInterface({ input, output, terminal: true });
  console.log(renderBanner({ model: options.model || config.model, cwd: options.cwd || process.cwd() }));
  console.log(formatInfo(`session=${sessionId}  tools=${options.enableTools !== false ? 'on' : 'off'}  ${config.baseURL}`));

  let exitRequested = false;
  try {
    while (true) {
      const line = await readLine(rl);
      if (line === null) break; // readline closed (Ctrl+D / EOF)
      if (!line) continue;

      const cmd = parseSlashCommand(line);
      if (cmd) {
        const outcome = await handleSlashCommand(cmd, { messages, config, options });
        if (outcome === 'exit') { exitRequested = true; break; }
        continue;
      }

      messages.push({ role: 'user', content: line });
      // Close the input box now that readline has fully surrendered stdout
      const inputBox = renderInputBox(process.stdout.columns);
      if (inputBox) process.stdout.write(`${inputBox.bot}\n`);
      try {
        await runTurnAndUpdateHistory(messages, config, options, sessionId);
      } catch (err) {
        console.log(formatWarn(`request failed: ${String(err?.message || err)}`));
      }
    }
  } finally {
    rl.close();
    input.pause();
    await resetMcpRuntime().catch(() => {});
    extractMemoriesOnExit(messages, config, options, sessionId);
  }

  return { exitRequested };
}

// ─── Core agent turn ──────────────────────────────────────────────────────────

/**
 * Run one agent completion round with streaming + tool display.
 * Returns { result, hadStreamOutput } without writing the final newline caller
 * decides how to handle non-streamed output.
 */
async function runAgentTurn(messages, config, options, { isTerminal, verboseUi }) {
  const model = options.model || config.model;
  const uiState = { usage: null, toolCalls: 0, round: null };
  const toolArgMap = new Map();
  let streamStarted = false;

  const result = await runAgentCompletion({
    config,
    messages,
    model: options.model,
    temperature: options.temperature,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    enableTools: options.enableTools !== false,
    stream: options.stream !== false,
    cwd: options.cwd,
    maxToolRounds: options.maxToolRounds,
    onToken: isTerminal ? (token) => {
      if (!streamStarted) { process.stdout.write(formatAssistantHeader()); streamStarted = true; }
      process.stdout.write(token);
    } : undefined,
    onRoundStart: (round) => {
      uiState.round = round;
      if (streamStarted) { process.stdout.write('\n'); streamStarted = false; }
      if (verboseUi && isTerminal) {
        console.log(formatStatusBar({ phase: 'reason', model, usage: uiState.usage, toolCalls: uiState.toolCalls, round }));
      }
    },
    onUsage: ({ delta, aggregate, round }) => {
      uiState.usage = mergeUsage(uiState.usage, delta || aggregate);
      uiState.round = round || uiState.round;
      if (verboseUi && isTerminal && !streamStarted) {
        console.log(formatStatusBar({ phase: 'llm', model, usage: uiState.usage, toolCalls: uiState.toolCalls, round: uiState.round }));
      }
    },
    onToolCallStart: isTerminal ? ({ index, name, parsedArgs = {} }) => {
      if (streamStarted) { process.stdout.write('\n'); streamStarted = false; }
      uiState.toolCalls = index;
      toolArgMap.set(index, extractPrimaryArg(name, parsedArgs));
      if (verboseUi && !isInternalTool(name)) console.log(formatToolStart(name, index));
    } : undefined,
    onToolCallEnd: isTerminal ? ({ name, ok, durationMs, output, index }) => {
      if (isInternalTool(name)) return;
      if (verboseUi) {
        console.log(formatToolEnd(name, ok, durationMs, { output }));
      } else {
        console.log(formatToolLine(name, ok, durationMs, toolArgMap.get(index) || ''));
      }
    } : undefined,
    onCompact: isTerminal ? ({ round }) => {
      console.log(formatInfo(`[compact] context compressed at round ${round}`));
    } : undefined,
  });

  const hadStreamOutput = streamStarted;
  if (streamStarted) process.stdout.write('\n');
  return { result, hadStreamOutput };
}

// ─── Interactive loop helpers ─────────────────────────────────────────────────

/** Read one trimmed line; returns null on EOF/close. */
async function readLine(rl) {
  try {
    const box = renderInputBox(process.stdout.columns);
    process.stdout.write(box ? `\n${box.top}\n` : '\n');
    return normalizeChatInput(await rl.question(promptUser()));
  } catch (err) {
    if (String(err.message).toLowerCase().includes('readline was closed')) return null;
    throw err;
  }
}

/**
 * Handle a slash command; returns:
 *   'exit'    → break the chat loop
 *   'handled' → continue the loop (command consumed)
 *   null      → unknown command, fall through to AI
 */
async function handleSlashCommand(cmd, { messages, config, options }) {
  const { name, argsText } = cmd;
  const subArgs = argsText ? argsText.split(/\s+/) : [];

  switch (name) {
    case 'exit':
    case 'quit':
      return 'exit';

    case 'clear':
      messages.length = 0;
      messages.push(...(await buildBaseMessages(options.systemPrompt, 'chat', options.cwd)));
      console.log(formatSuccess('history cleared.'));
      return 'handled';

    case 'help':
      console.log(formatInfo(
        'commands: /help /clear /plan <goal> /status /usage [days] /session ... ' +
        '/plugins ... /skills ... /mcp ... /models ... /tasks ... /exit'
      ));
      return 'handled';

    case 'status':
      await runStatusCommand();
      return 'handled';

    case 'usage':
      await runCostCommand(argsText ? [argsText] : []);
      return 'handled';

    case 'session':
      await runSessionCommand(subArgs);
      return 'handled';

    case 'plugins':
      await runPluginsCommand(subArgs);
      return 'handled';

    case 'skills':
      await runSkillsCommand(subArgs);
      return 'handled';

    case 'mcp':
      await runMcpCommand(subArgs);
      return 'handled';

    case 'tasks':
      await runTasksCommand(subArgs);
      return 'handled';

    case 'models':
      try { await runModelsCommand(subArgs); }
      catch (err) { console.log(formatWarn(`models: ${String(err?.message || err)}`)); }
      return 'handled';

    case 'plan':
      if (!argsText) { console.log(formatWarn('usage: /plan <goal>')); return 'handled'; }
      try {
        const plan = await runQuickPlan(argsText, config, options);
        if (plan) console.log(formatAssistant(plan));
      } catch (err) {
        console.log(formatWarn(`plan: ${String(err?.message || err)}`));
      }
      return 'handled';

    default:
      return null; // unrecognized → pass to AI
  }
}

/** Execute one turn, update message history, run compaction, persist session. */
async function runTurnAndUpdateHistory(messages, config, options, sessionId) {
  const { result, hadStreamOutput } = await runAgentTurn(messages, config, options, {
    isTerminal: true,
    verboseUi: Boolean(options.verboseUi),
  });

  if (!hadStreamOutput && result.text) {
    process.stdout.write(formatAssistantHeader());
    console.log(result.text.trim());
  }

  // Merge updated message history returned by the agent loop (includes tool turns)
  if (Array.isArray(result.messages) && result.messages.length) {
    messages.length = 0;
    messages.push(...result.messages);
  } else {
    messages.push({ role: 'assistant', content: (result.text || '').trim() });
  }

  // Cross-turn compaction: run when we're near the context limit
  const promptTokens = result.usage?.prompt_tokens || 0;
  const threshold = config.compactionThreshold || 80000;
  if (promptTokens >= threshold) {
    const compact = await maybeCompact(messages, config, {
      currentTokens: promptTokens,
      compactionThreshold: threshold,
    });
    if (compact.compacted) {
      messages.length = 0;
      messages.push(...compact.messages);
      if (options.verboseUi) {
        console.log(formatInfo(`[compact] session compressed (was ~${promptTokens} tokens)`));
      }
    }
  }

  if (!options.noHistory) {
    await saveSession(messages.filter((m) => m.role !== 'system'), sessionId);
  }
}

function extractMemoriesOnExit(messages, config, options, sessionId) {
  const persist = messages.filter((m) => m.role !== 'system');
  if (persist.length >= 4) {
    extractAndSaveMemory(persist, config, {
      sessionId,
      cwd: options.cwd || process.cwd(),
    }).catch(() => {});
  }
}

// ─── Base message builder ─────────────────────────────────────────────────────

async function buildBaseMessages(systemPrompt, mode = 'chat', cwd = process.cwd()) {
  const defaultPrompt = mode === 'task'
    ? 'You are ovopre, an autonomous coding CLI agent. ' +
      'Primary goal: complete the user task end-to-end. ' +
      'You can call tools to inspect files, edit files, and run shell commands. ' +
      'Work directly and efficiently. Do not ask for permission before tool usage.'
    : 'You are ovopre, a pragmatic coding CLI assistant.\n\n' +
      'When a request involves tool use or file changes, follow this structure:\n\n' +
      '1. OUTPUT A PLAN FIRST (before any tool calls):\n' +
      '   Plan:\n' +
      '   1. First major step\n' +
      '      - sub-step or detail\n' +
      '      - sub-step or detail\n' +
      '   2. Second major step\n' +
      '      - detail\n\n' +
      '2. EXECUTE STEP BY STEP. At the start of each major step emit a short marker:\n' +
      '   → Step 1: <brief description>\n\n' +
      '3. REPORT WHEN DONE:\n' +
      '   Done. <files changed>, <what changed>, <outcome>.\n\n' +
      'For simple questions or explanations: answer directly, no plan needed.\n' +
      'Do not be chatty or pad responses. Do not repeat the plan in the summary.\n' +
      'If blocked mid-execution, state the blocker and adjust the remaining plan steps.';

  const [skillsAddendum, memoriesAddendum] = await Promise.all([
    buildSkillsSystemAddendum(cwd),
    loadMemoriesForPrompt(cwd).catch(() => ''),
  ]);

  const parts = [systemPrompt || defaultPrompt, skillsAddendum, memoriesAddendum].filter(Boolean);
  return [{ role: 'system', content: parts.join('\n\n') }];
}

// ─── Quick plan (used by /plan) ──────────────────────────────────────────────

async function runQuickPlan(goal, config, options = {}) {
  const skillsAddendum = await buildSkillsSystemAddendum(options.cwd || process.cwd());
  const systemContent = [
    'You are a senior coding planner. Output practical plans.',
    skillsAddendum,
  ].filter(Boolean).join('\n\n');

  const result = await runAgentCompletion({
    config,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: [
        `Task goal:\n${goal}`,
        'Create a concise implementation plan with sections:',
        '1) Files to inspect/edit',
        '2) Concrete steps',
        '3) Verification commands (shell)',
        'Be specific and executable.',
      ].join('\n\n') },
    ],
    model: options.model,
    temperature: options.temperature,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    enableTools: false,
    stream: false,
    cwd: options.cwd,
  });
  return String(result.text || '').trim();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

// Tool names that are internal state mechanics — not shown in the tool display.
const INTERNAL_TOOLS = new Set(['enter_plan_mode', 'exit_plan_mode', 'tool_search']);

function isInternalTool(name) {
  return INTERNAL_TOOLS.has(String(name).toLowerCase());
}

function printTaskProgress(event) {
  if (!event?.type) return;
  switch (event.type) {
    case 'plan': {
      const text = String(event.text || '').trim();
      if (text) { console.log(formatInfo('[plan]')); console.log(text); }
      break;
    }
    case 'attempt_start':
      console.log(formatInfo(`[progress] attempt ${event.attempt}/${event.totalAttempts}`));
      break;
    case 'verify':
      if (event.passed) {
        console.log(formatSuccess(`[verify] passed in round ${event.rounds}`));
      } else {
        const failed = (event.failedCommands || []).filter(Boolean).join(' | ');
        console.log(formatWarn(`[verify] failed (${event.failureCategory || 'unknown'})${failed ? ` — ${failed}` : ''}`));
      }
      break;
    case 'retry': {
      const detail = String(event.failureDetail || '').split('\n')[0].slice(0, 140);
      console.log(formatWarn(
        `[retry] ${event.attempt}/${event.totalAttempts}` +
        (detail ? `, reason: ${detail}` : '')
      ));
      break;
    }
  }
}

function normalizeChatInput(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // strip zero-width chars
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSlashCommand(line) {
  if (!line.startsWith('/')) return null;
  const match = /^\/([^\s]+)(?:\s+(.*))?$/u.exec(line);
  if (!match) return null;
  return {
    name: match[1].toLowerCase(),
    argsText: (match[2] || '').trim(),
  };
}
