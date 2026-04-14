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
  formatToolStart,
  formatWarn,
  promptUser,
  renderBanner
} from '../ui/terminal.js';

export async function runOneShot(prompt, options = {}) {
  const config = await loadRuntimeConfig(options.cwd);
  const enableTools = options.enableTools !== false;
  const fmt = createFormatter(options.output);
  const messages = await buildBaseMessages(options.systemPrompt, options.mode || 'chat', options.cwd);
  messages.push({ role: 'user', content: prompt });

  let streamStarted = false;
  const handleToken = fmt.isJson || fmt.isPlain
    ? undefined  // non-terminal: buffer and emit via fmt.result
    : (token) => {
        if (!streamStarted) streamStarted = true;
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
    onToken: handleToken
  });

  if (streamStarted) {
    process.stdout.write('\n');
  } else {
    fmt.result((result.text || '').trim(), result.usage);
  }
}

export async function runTask(goal, options = {}) {
  const config = await loadRuntimeConfig(options.cwd);
  const fmt = createFormatter(options.output);
  const state = { usage: null, toolCalls: 0, round: null };
  const model = options.model || config.model;
  if (!fmt.isJson) {
    console.log(formatStatusBar({ phase: 'task:plan', model, usage: state.usage, toolCalls: state.toolCalls, round: state.round }));
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
        console.log(
          formatStatusBar({ phase: `task:${stage}`, model, usage: state.usage, toolCalls: state.toolCalls, round: state.round })
        );
      },
      onRoundStart: (round) => {
        state.round = round;
        console.log(
          formatStatusBar({
            phase: 'task:execute',
            model,
            usage: state.usage,
            toolCalls: state.toolCalls,
            round: state.round
          })
        );
      },
      onUsage: ({ delta, aggregate, round }) => {
        state.usage = addUsage(state.usage, delta || aggregate);
        state.round = round || state.round;
        console.log(
          formatStatusBar({
            phase: 'task:llm',
            model,
            usage: state.usage,
            toolCalls: state.toolCalls,
            round: state.round
          })
        );
      },
      onToolCallStart: ({ index, name }) => {
        state.toolCalls = index;
        console.log(formatToolStart(name, index));
      },
      onToolCallEnd: ({ name, ok, durationMs }) => {
        console.log(formatToolEnd(name, ok, durationMs));
      }
    }
  });
  fmt.taskResult(result.ok, result.summary, state.usage);
}

export async function runInteractiveChat(options = {}) {
  const config = await loadRuntimeConfig(options.cwd);
  const enableTools = options.enableTools !== false;
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

  try {
    while (true) {
      let line = '';
      try {
        line = (await rl.question(promptUser())).trim();
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
      if (line === '/exit' || line === '/quit') {
        break;
      }
      if (line === '/clear') {
        messages.length = 0;
        messages.push(...(await buildBaseMessages(options.systemPrompt, 'chat', options.cwd)));
        console.log(formatSuccess('history cleared.'));
        continue;
      }
      if (line === '/help') {
        console.log(
          formatInfo(
            'commands: /help /clear /plan <goal> /status /usage [days] /session ... /plugins ... /skills ... /mcp ... /models ... /task <goal> /tasks ... /exit'
          )
        );
        continue;
      }
      if (line === '/status') {
        await runStatusCommand();
        continue;
      }
      if (line.startsWith('/usage')) {
        const arg = line.replace(/^\/usage\s*/, '').trim();
        await runCostCommand(arg ? [arg] : []);
        continue;
      }
      if (line.startsWith('/session')) {
        const sub = line.replace(/^\/session\s*/, '').trim();
        await runSessionCommand(sub ? sub.split(/\s+/) : []);
        continue;
      }
      if (line.startsWith('/plugins')) {
        const sub = line.replace(/^\/plugins\s*/, '').trim();
        await runPluginsCommand(sub ? sub.split(/\s+/) : []);
        continue;
      }
      if (line.startsWith('/skills')) {
        const sub = line.replace(/^\/skills\s*/, '').trim();
        await runSkillsCommand(sub ? sub.split(/\s+/) : []);
        continue;
      }
      if (line.startsWith('/mcp')) {
        const sub = line.replace(/^\/mcp\s*/, '').trim();
        await runMcpCommand(sub ? sub.split(/\s+/) : []);
        continue;
      }
      if (line.startsWith('/tasks')) {
        const sub = line.replace(/^\/tasks\s*/, '').trim();
        await runTasksCommand(sub ? sub.split(/\s+/) : []);
        continue;
      }
      if (line === '/models' || line.startsWith('/models ')) {
        const sub = line.replace(/^\/models\s*/, '').trim();
        const args = sub ? sub.split(/\s+/) : [];
        try {
          await runModelsCommand(args);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(formatWarn(`models failed: ${message}`));
        }
        continue;
      }
      if (line.startsWith('/plan ')) {
        const goal = line.slice('/plan '.length).trim();
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
      if (line.startsWith('/task ')) {
        const goal = line.slice('/task '.length).trim();
        if (!goal) {
          console.log(formatWarn('usage: /task <goal>'));
          continue;
        }
        const state = { usage: null, toolCalls: 0, round: null };
        const model = options.model || config.model;
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
                console.log(
                  formatStatusBar({
                    phase: `task:${stage}`,
                    model,
                    usage: state.usage,
                    toolCalls: state.toolCalls,
                    round: state.round
                  })
                );
              },
              onRoundStart: (round) => {
                state.round = round;
                console.log(
                  formatStatusBar({
                    phase: 'task:execute',
                    model,
                    usage: state.usage,
                    toolCalls: state.toolCalls,
                    round: state.round
                  })
                );
              },
              onUsage: ({ delta, aggregate, round }) => {
                state.usage = addUsage(state.usage, delta || aggregate);
                state.round = round || state.round;
                console.log(
                  formatStatusBar({
                    phase: 'task:llm',
                    model,
                    usage: state.usage,
                    toolCalls: state.toolCalls,
                    round: state.round
                  })
                );
              },
              onToolCallStart: ({ index, name }) => {
                state.toolCalls = index;
                console.log(formatToolStart(name, index));
              },
              onToolCallEnd: ({ name, ok, durationMs }) => {
                console.log(formatToolEnd(name, ok, durationMs));
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

      messages.push({ role: 'user', content: line });
      const uiState = { usage: null, toolCalls: 0, round: null };
      const model = options.model || config.model;
      console.log(formatStatusBar({ phase: 'thinking', model, usage: uiState.usage, toolCalls: uiState.toolCalls }));

      try {
        // When tools are enabled we now stream every round, so we write
        // the assistant prefix once on the first token and then stream directly.
        let streamStarted = false;
        const handleToken = (token) => {
          if (!streamStarted) {
            process.stdout.write(formatAssistant(''));
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
          onRoundStart: (round) => {
            uiState.round = round;
            // If text was streaming before a tool call, close that line first
            if (streamStarted) {
              process.stdout.write('\n');
              streamStarted = false;
            }
            console.log(
              formatStatusBar({
                phase: 'reason',
                model,
                usage: uiState.usage,
                toolCalls: uiState.toolCalls,
                round: uiState.round
              })
            );
          },
          onUsage: ({ delta, aggregate, round }) => {
            uiState.usage = addUsage(uiState.usage, delta || aggregate);
            uiState.round = round || uiState.round;
            console.log(
              formatStatusBar({
                phase: 'llm',
                model,
                usage: uiState.usage,
                toolCalls: uiState.toolCalls,
                round: uiState.round
              })
            );
          },
          onToolCallStart: ({ index, name }) => {
            if (streamStarted) {
              process.stdout.write('\n');
              streamStarted = false;
            }
            uiState.toolCalls = index;
            console.log(formatToolStart(name, index));
            console.log(
              formatStatusBar({
                phase: 'tools',
                model,
                usage: uiState.usage,
                toolCalls: uiState.toolCalls,
                round: uiState.round
              })
            );
          },
          onToolCallEnd: ({ name, ok, durationMs }) => {
            console.log(formatToolEnd(name, ok, durationMs));
          },
          onToken: handleToken,
          onCompact: ({ round, summary }) => {
            console.log(
              formatInfo(
                `[compact] context compressed before round ${round} (${summary ? summary.length : 0} chars summary)`
              )
            );
          }
        });

        // Close any in-progress streaming line
        if (streamStarted) {
          process.stdout.write('\n');
          streamStarted = false;
        } else if (!enableTools) {
          // Non-tools path with no streaming: print the full answer
          process.stdout.write('\n');
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
            console.log(
              formatInfo(
                `[compact] session history compressed (was ~${lastPromptTokens} tokens)`
              )
            );
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
    // Extract memories from this session (fire-and-forget — never blocks exit)
    const persist = messages.filter((m) => m.role !== 'system');
    if (persist.length >= 4) {
      extractAndSaveMemory(persist, config, {
        sessionId,
        cwd: options.cwd || process.cwd()
      }).catch(() => {});
    }
  }
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
      : 'You are ovopre, a pragmatic coding CLI assistant. Give direct, useful, implementation-focused answers.';
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
