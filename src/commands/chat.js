import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadRuntimeConfig } from '../core/config.js';
import { loadSession, saveSession } from '../core/sessionStore.js';
import { runAgentCompletion } from '../core/agentLoop.js';
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
  formatAssistant,
  formatInfo,
  formatStatusBar,
  formatSuccess,
  formatToolEnd,
  formatToolLine,
  formatToolStart,
  formatWarn,
  promptUser,
  renderBanner,
} from '../ui/terminal.js';

export async function runOneShot(prompt, options = {}) {
  const config = await loadRuntimeConfig(options.cwd);
  const enableTools = options.enableTools !== false;
  const verboseUi = Boolean(options.verboseUi);
  const fmt = createFormatter(options.output);
  const messages = await buildBaseMessages(options.systemPrompt, options.mode || 'chat', options.cwd);
  messages.push({ role: 'user', content: prompt });
  const uiState = { usage: null, toolCalls: 0, round: null };
  const model = options.model || config.model;
  const toolArgMap = new Map();

  let streamStarted = false;
  const handleToken = fmt.isJson || fmt.isPlain
    ? undefined
    : (token) => {
        if (!streamStarted) {
          process.stdout.write('\n');
          streamStarted = true;
        }
        process.stdout.write(token);
      };

  const result = await runAgentCompletion({
    config,
    messages,
    model: options.model,
    temperature: options.temperature,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    enableTools,
    stream: options.stream !== false,
    cwd: options.cwd,
    maxToolRounds: options.maxToolRounds,
    onToken: handleToken,
    onRoundStart: fmt.isTerminal && verboseUi
      ? (round) => {
          uiState.round = round;
          if (streamStarted) { process.stdout.write('\n'); streamStarted = false; }
          console.log(formatStatusBar({ phase: 'reason', model, usage: uiState.usage, toolCalls: uiState.toolCalls, round }));
        }
      : (round) => { uiState.round = round; },
    onUsage: ({ delta, aggregate, round }) => {
      uiState.usage = addUsage(uiState.usage, delta || aggregate);
      uiState.round = round || uiState.round;
      if (fmt.isTerminal && verboseUi && !streamStarted) {
        console.log(formatStatusBar({ phase: 'llm', model, usage: uiState.usage, toolCalls: uiState.toolCalls, round: uiState.round }));
      }
    },
    onToolCallStart: fmt.isTerminal
      ? ({ index, name, call }) => {
          if (streamStarted) { process.stdout.write('\n'); streamStarted = false; }
          uiState.toolCalls = index;
          let parsedArgs = {};
          try { parsedArgs = JSON.parse(call?.function?.arguments || '{}'); } catch {}
          toolArgMap.set(index, extractPrimaryArg(name, parsedArgs));
          if (verboseUi) console.log(formatToolStart(name, index));
        }
      : undefined,
    onToolCallEnd: fmt.isTerminal
      ? ({ name, ok, durationMs, output, index }) => {
          if (verboseUi) {
            console.log(formatToolEnd(name, ok, durationMs, { output }));
          } else {
            console.log(formatToolLine(name, ok, durationMs, toolArgMap.get(index) || ''));
          }
        }
      : undefined
  });

  if (streamStarted) process.stdout.write('\n');
  if (!streamStarted) {
    fmt.result((result.text || '').trim(), result.usage);
  }
}

export async function runTask(goal, options = {}) {
  const config = await loadRuntimeConfig(options.cwd);
  const fmt = createFormatter(options.output);
  const state = { usage: null, toolCalls: 0, round: null };
  const model = options.model || config.model;
  if (!fmt.isJson) {
    console.log(formatStatusBar({ phase: 'task:start', model, usage: null, toolCalls: 0 }));
  }
  const result = await runTaskStateMachine({
    goal,
    config,
    options: {
      ...options,
      mode: 'task',
      enableTools: options.enableTools !== false,
      quiet: true,
      onStage: ({ stage }) => {
        if (!fmt.isJson) {
          console.log(formatStatusBar({ phase: `task:${stage}`, model, usage: state.usage, toolCalls: state.toolCalls, round: state.round }));
        }
      },
      onRoundStart: (round) => {
        state.round = round;
        // silent — stage change already signals phase transitions
      },
      onUsage: ({ delta, aggregate, round }) => {
        state.usage = addUsage(state.usage, delta || aggregate);
        state.round = round || state.round;
        // silent — token counts accumulate for final summary only
      },
      onToolCallStart: ({ index, name, call }) => {
        state.toolCalls = index;
        let parsedArgs = {};
        try { parsedArgs = JSON.parse(call?.function?.arguments || '{}'); } catch {}
        state.toolArgMap = state.toolArgMap || new Map();
        state.toolArgMap.set(index, extractPrimaryArg(name, parsedArgs));
      },
      onToolCallEnd: ({ name, ok, durationMs, index }) => {
        console.log(formatToolLine(name, ok, durationMs, (state.toolArgMap && state.toolArgMap.get(index)) || ''));
      },
      onProgress: (event) => {
        printTaskProgress(event);
      }
    }
  });
  fmt.taskResult(result.ok, result.summary, state.usage);
}

export async function runInteractiveChat(options = {}) {
  const config = await loadRuntimeConfig(options.cwd);
  const enableTools = options.enableTools !== false;
  const verboseUi = Boolean(options.verboseUi);
  const planPreview = Boolean(options.planPreview);
  const sessionId = options.sessionId || 'default';
  const history = options.noHistory ? [] : await loadSession(sessionId);
  const baseMessages = await buildBaseMessages(options.systemPrompt, 'chat', options.cwd);
  const messages = [...baseMessages, ...history];

  const rl = readline.createInterface({ input, output, terminal: true });
  console.log(
    renderBanner({
      model: options.model || config.model,
      cwd: options.cwd || process.cwd()
    })
  );
  console.log(formatInfo(`session=${sessionId} tools=${enableTools ? 'on' : 'off'} baseURL=${config.baseURL}`));
  let exitRequested = false;

  try {
    while (true) {
      let line = '';
      try {
        line = normalizeChatInput(await rl.question(promptUser()));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes('readline was closed')) {
          break;
        }
        throw error;
      }
      if (!line) {
        continue;
      }
      const slash = parseSlashCommand(line);
      if (slash?.name === 'exit' || slash?.name === 'quit') {
        exitRequested = true;
        break;
      }
      if (slash?.name === 'clear') {
        messages.length = 0;
        messages.push(...(await buildBaseMessages(options.systemPrompt, 'chat', options.cwd)));
        console.log(formatSuccess('history cleared.'));
        continue;
      }
      if (slash?.name === 'help') {
        console.log(
          formatInfo(
            'commands: /help /clear /plan <goal> /status /usage [days] /session ... /plugins ... /skills ... /mcp ... /models ... /task <goal> /tasks ... /exit'
          )
        );
        continue;
      }
      if (slash?.name === 'status') {
        await runStatusCommand();
        continue;
      }
      if (slash?.name === 'usage') {
        const arg = slash.argsText;
        await runCostCommand(arg ? [arg] : []);
        continue;
      }
      if (slash?.name === 'session') {
        const sub = slash.argsText;
        await runSessionCommand(sub ? sub.split(/\s+/) : []);
        continue;
      }
      if (slash?.name === 'plugins') {
        const sub = slash.argsText;
        await runPluginsCommand(sub ? sub.split(/\s+/) : []);
        continue;
      }
      if (slash?.name === 'skills') {
        const sub = slash.argsText;
        await runSkillsCommand(sub ? sub.split(/\s+/) : []);
        continue;
      }
      if (slash?.name === 'mcp') {
        const sub = slash.argsText;
        await runMcpCommand(sub ? sub.split(/\s+/) : []);
        continue;
      }
      if (slash?.name === 'tasks') {
        const sub = slash.argsText;
        await runTasksCommand(sub ? sub.split(/\s+/) : []);
        continue;
      }
      if (slash?.name === 'models') {
        const sub = slash.argsText;
        const args = sub ? sub.split(/\s+/) : [];
        try {
          await runModelsCommand(args);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(formatWarn(`models failed: ${message}`));
        }
        continue;
      }
      if (slash?.name === 'plan') {
        const goal = slash.argsText;
        if (!goal) {
          console.log(formatWarn('usage: /plan <goal>'));
          continue;
        }
        try {
          const planned = await runQuickPlan(goal, options);
          console.log(formatAssistant(planned));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(formatWarn(`plan failed: ${message}`));
        }
        continue;
      }
      if (slash?.name === 'task') {
        const goal = slash.argsText;
        if (!goal) {
          console.log(formatWarn('usage: /task <goal>'));
          continue;
        }
        const state = { usage: null, toolCalls: 0, round: null };
        const taskModel = options.model || config.model;
        try {
          const taskResult = await runTaskStateMachine({
            goal,
            config,
            options: {
              ...options,
              mode: 'task',
              enableTools,
              quiet: true,
              onStage: ({ stage }) => {
                console.log(formatStatusBar({ phase: `task:${stage}`, model: taskModel, usage: state.usage, toolCalls: state.toolCalls, round: state.round }));
              },
              onRoundStart: (round) => {
                state.round = round;
              },
              onUsage: ({ delta, aggregate, round }) => {
                state.usage = addUsage(state.usage, delta || aggregate);
                state.round = round || state.round;
              },
              onToolCallStart: ({ index, name, call }) => {
                state.toolCalls = index;
                let parsedArgs = {};
                try { parsedArgs = JSON.parse(call?.function?.arguments || '{}'); } catch {}
                state.toolArgMap = state.toolArgMap || new Map();
                state.toolArgMap.set(index, extractPrimaryArg(name, parsedArgs));
              },
              onToolCallEnd: ({ name, ok, durationMs, index }) => {
                console.log(formatToolLine(name, ok, durationMs, (state.toolArgMap && state.toolArgMap.get(index)) || ''));
              },
              onProgress: (event) => {
                printTaskProgress(event);
              }
            }
          });
          console.log(formatAssistant((taskResult.summary || '').trim()));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(formatWarn(`task failed: ${message}`));
        }
        continue;
      }

      if (enableTools && planPreview) {
        try {
          const planned = await runQuickPlan(line, { ...options, temperature: 0 });
          const planText = String(planned || '').trim();
          if (planText) {
            console.log(formatInfo('[plan]'));
            console.log(planText);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(formatWarn(`plan preview failed: ${message}`));
        }
      }

      messages.push({ role: 'user', content: line });
      const uiState = { usage: null, toolCalls: 0, round: null };
      const model = options.model || config.model;
      if (verboseUi) {
        console.log(formatStatusBar({ phase: 'thinking', model, usage: uiState.usage, toolCalls: uiState.toolCalls }));
      }

      try {
        let streamStarted = false;
        const toolArgMap = new Map();

        const handleToken = (token) => {
          if (!streamStarted) {
            process.stdout.write('\n');
            streamStarted = true;
          }
          process.stdout.write(token);
        };

        const result = await runAgentCompletion({
          config,
          messages,
          model: options.model,
          temperature: options.temperature,
          timeoutMs: options.timeoutMs,
          maxRetries: options.maxRetries,
          enableTools,
          stream: options.stream !== false,
          cwd: options.cwd,
          maxToolRounds: options.maxToolRounds,
          onToken: handleToken,
          onRoundStart: (round) => {
            uiState.round = round;
            if (streamStarted) { process.stdout.write('\n'); streamStarted = false; }
            if (verboseUi) {
              console.log(formatStatusBar({ phase: 'reason', model, usage: uiState.usage, toolCalls: uiState.toolCalls, round }));
            }
          },
          onUsage: ({ delta, aggregate, round }) => {
            uiState.usage = addUsage(uiState.usage, delta || aggregate);
            uiState.round = round || uiState.round;
            if (verboseUi && !streamStarted) {
              console.log(formatStatusBar({ phase: 'llm', model, usage: uiState.usage, toolCalls: uiState.toolCalls, round: uiState.round }));
            }
          },
          onToolCallStart: ({ index, name, call }) => {
            if (streamStarted) { process.stdout.write('\n'); streamStarted = false; }
            uiState.toolCalls = index;
            let parsedArgs = {};
            try { parsedArgs = JSON.parse(call?.function?.arguments || '{}'); } catch {}
            toolArgMap.set(index, extractPrimaryArg(name, parsedArgs));
            if (verboseUi) {
              console.log(formatToolStart(name, index));
            }
          },
          onToolCallEnd: ({ name, ok, durationMs, output, index }) => {
            if (verboseUi) {
              console.log(formatToolEnd(name, ok, durationMs, { output }));
            } else {
              console.log(formatToolLine(name, ok, durationMs, toolArgMap.get(index) || ''));
            }
          },
          onCompact: ({ round, summary }) => {
            console.log(formatInfo(`[compact] context compressed before round ${round} (${summary ? summary.length : 0} chars summary)`));
          }
        });

        // Close any in-progress streaming line
        const hadStreamOutput = streamStarted;
        if (streamStarted) {
          process.stdout.write('\n');
          streamStarted = false;
        }
        // Non-streaming, no-tools path: print the buffered response
        if (!hadStreamOutput && result.text) {
          console.log(formatAssistant((result.text || '').trim()));
        }

        const answer = (result.text || '').trim();
        if (Array.isArray(result.messages) && result.messages.length) {
          messages.length = 0;
          messages.push(...result.messages);
        } else {
          messages.push({ role: 'assistant', content: answer });
        }

        // Cross-turn compaction: if the last prompt_tokens usage shows we're
        // approaching the context limit, compact before the next user turn.
        const lastPromptTokens = result.usage?.prompt_tokens || 0;
        const compactionThreshold =
          (process.env.OVOPRE_COMPACTION_THRESHOLD ? Number(process.env.OVOPRE_COMPACTION_THRESHOLD) : 0) ||
          config.compactionThreshold ||
          80000;
        if (lastPromptTokens >= compactionThreshold) {
          const compactResult = await maybeCompact(messages, config, {
            currentTokens: lastPromptTokens,
            compactionThreshold
          });
          if (compactResult.compacted) {
            messages.length = 0;
            messages.push(...compactResult.messages);
            if (verboseUi) {
              console.log(
                formatInfo(
                  `[compact] session history compressed (was ~${lastPromptTokens} tokens)`
                )
              );
            }
          }
        }

        if (!options.noHistory) {
          const persist = messages.filter((m) => m.role !== 'system');
          await saveSession(persist, sessionId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(formatWarn(`request failed: ${message}`));
      }
    }
  } finally {
    rl.close();
    input.pause();
    await resetMcpRuntime().catch(() => {});
    // Extract memories from this session (fire-and-forget — never blocks exit)
    const persist = messages.filter((m) => m.role !== 'system');
    if (persist.length >= 4) {
      extractAndSaveMemory(persist, config, {
        sessionId,
        cwd: options.cwd || process.cwd()
      }).catch(() => {});
    }
  }

  return { exitRequested };
}

async function buildBaseMessages(systemPrompt, mode = 'chat', cwd = process.cwd()) {
  const defaultPrompt =
    mode === 'task'
      ? [
          'You are ovopre, an autonomous coding CLI agent.',
          'Primary goal: complete the user task end-to-end.',
          'You can call tools to inspect files, edit files, and run shell commands.',
          'Work directly and efficiently. Do not ask for permission before tool usage.'
        ].join(' ')
      : [
          'You are ovopre, a pragmatic coding CLI assistant.',
          'In interactive chat mode, behave like a polished terminal coding agent.',
          'Do the work silently when tools are needed, then report the outcome plainly.',
          'Do not expose internal planning, hidden reasoning, tool names, task stages, verification checklists, or step-by-step execution unless the user explicitly asks for them.',
          'Do not say you are planning, thinking, or about to use tools.',
          'Do not be chatty, sarcastic, or mention that the user asked something before unless they explicitly ask about history.',
          'If blocked, state the blocker directly and give the shortest useful next action.'
        ].join(' ');
  const prompt = systemPrompt || defaultPrompt;

  const [skillsAddendum, memoriesAddendum] = await Promise.all([
    buildSkillsSystemAddendum(cwd),
    loadMemoriesForPrompt(cwd).catch(() => '') // memory loading never blocks startup
  ]);

  const parts = [prompt];
  if (skillsAddendum) parts.push(skillsAddendum);
  if (memoriesAddendum) parts.push(memoriesAddendum);

  return [{ role: 'system', content: parts.join('\n\n') }];
}

async function runQuickPlan(goal, options = {}) {
  const config = await loadRuntimeConfig(options.cwd);
  const skillsAddendum = await buildSkillsSystemAddendum(options.cwd || process.cwd());
  const prompt = [
    `Task goal:\n${goal}`,
    'Create a concise implementation plan with sections:',
    '1) Files to inspect/edit',
    '2) Concrete steps',
    '3) Verification commands (shell)',
    'Be specific and executable.'
  ].join('\n\n');

  const result = await runAgentCompletion({
    config,
    messages: [
      {
        role: 'system',
        content: skillsAddendum
          ? `You are a senior coding planner. Output practical plans.\n\n${skillsAddendum}`
          : 'You are a senior coding planner. Output practical plans.'
      },
      { role: 'user', content: prompt }
    ],
    model: options.model,
    temperature: options.temperature,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    enableTools: false,
    stream: false,
    cwd: options.cwd
  });
  return String(result.text || '').trim();
}

function addUsage(current, extra) {
  if (!extra) {
    return current || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }
  const base = current || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  return {
    prompt_tokens: Number(base.prompt_tokens || 0) + Number(extra.prompt_tokens || 0),
    completion_tokens: Number(base.completion_tokens || 0) + Number(extra.completion_tokens || 0),
    total_tokens: Number(base.total_tokens || 0) + Number(extra.total_tokens || 0)
  };
}

/**
 * Extract the most meaningful argument from a tool call to show in the UI.
 * Returns a short string like "README.md" or "npm test" to display as
 *   ⏺ read_file(README.md)  3ms
 */
function extractPrimaryArg(name, args) {
  if (!args || typeof args !== 'object') return '';
  // Common argument name patterns ordered by priority
  const candidates = [
    args.path, args.file_path, args.filename, args.file,
    args.command, args.cmd,
    args.query, args.pattern,
    args.url,
    args.content && args.path ? args.path : null,  // write_file: show path not content
  ];
  for (const v of candidates) {
    if (v && typeof v === 'string') {
      // shorten to last path segment if it looks like a path
      const short = v.includes('/') ? v.split('/').filter(Boolean).pop() || v : v;
      return short.length > 40 ? short.slice(0, 39) + '…' : short;
    }
  }
  // fallback: first string value in args
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v.length > 0) {
      return v.length > 40 ? v.slice(0, 39) + '…' : v;
    }
  }
  return '';
}

function printTaskProgress(event) {
  if (!event || !event.type) {
    return;
  }

  if (event.type === 'plan') {
    const text = String(event.text || '').trim();
    if (!text) {
      return;
    }
    console.log(formatInfo('[plan]'));
    console.log(text);
    return;
  }

  if (event.type === 'attempt_start') {
    console.log(formatInfo(`[progress] attempt ${event.attempt}/${event.totalAttempts}`));
    return;
  }

  if (event.type === 'verify') {
    if (event.passed) {
      console.log(formatSuccess(`[verify] passed in round ${event.rounds}`));
      return;
    }
    const failed = Array.isArray(event.failedCommands) ? event.failedCommands.filter(Boolean) : [];
    const suffix = failed.length ? ` failed: ${failed.join(' | ')}` : '';
    console.log(formatWarn(`[verify] failed (${event.failureCategory || 'unknown'})${suffix}`));
    return;
  }

  if (event.type === 'retry') {
    const detail = String(event.failureDetail || '').split('\n')[0].slice(0, 140);
    const more = detail ? `, reason: ${detail}` : '';
    console.log(
      formatWarn(
        `[retry] ${event.attempt}/${event.totalAttempts}, next ${event.nextAttempt}/${event.totalAttempts}${more}`
      )
    );
  }
}

function normalizeChatInput(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSlashCommand(line) {
  const normalized = normalizeChatInput(line);
  if (!normalized.startsWith('/')) {
    return null;
  }

  const match = /^\/([^\s]+)(?:\s+(.*))?$/u.exec(normalized);
  if (!match) {
    return null;
  }

  return {
    name: String(match[1] || '').toLowerCase(),
    argsText: String(match[2] || '').trim()
  };
}
