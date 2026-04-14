import { runAgentCompletion } from './agentLoop.js';
import { executeToolCall } from '../tools/executor.js';
import { buildSkillsSystemAddendum } from '../skills/loader.js';
import { createTaskTrace } from '../observability/taskTrace.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function runTaskStateMachine({ goal, config, options = {} }) {
  const maxTaskRetries = normalizeInt(options.maxTaskRetries, 2);
  const maxAttempts = maxTaskRetries + 1;
  const verifyRounds = normalizeInt(options.verifyRounds, 2);
  const taskModel = options.model || config.model || 'unknown';
  const trace = await createTaskTrace(goal, options.cwd || process.cwd(), {
    model: taskModel,
    taskType: options.taskType || 'task'
  });

  const stageContext = {
    goal,
    taskId: trace.taskId,
    tracePath: trace.tracePath,
    plan: '',
    execution: '',
    verify: []
  };
  const mutationStore = new Map();

  const skillsAddendum = await buildSkillsSystemAddendum(options.cwd || process.cwd());

  logTask(`task> ${trace.taskId}`, options);
  emitStage(options, { stage: 'plan', attempt: 1, totalAttempts: maxAttempts });
  const planStart = Date.now();
  const planResult = await runPlanningStage({ goal, config, options, skillsAddendum });
  stageContext.plan = planResult.text;
  await trace.event('stage_complete', {
    stage: 'plan',
    durationMs: Date.now() - planStart,
    usage: planResult.usage || null,
    planPreview: stageContext.plan.slice(0, 600)
  });

  let lastFailure = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    emitStage(options, { stage: 'execute', attempt, totalAttempts: maxAttempts });
    const executeStart = Date.now();
    const executionResult = await runExecuteStage({
      goal,
      plan: stageContext.plan,
      lastFailure,
      config,
      options,
      skillsAddendum,
      mutationStore
    });
    stageContext.execution = executionResult.text;
    await trace.event('stage_complete', {
      stage: 'execute',
      attempt,
      durationMs: Date.now() - executeStart,
      toolCalls: executionResult.toolCalls || 0,
      usage: executionResult.usage || null,
      executionPreview: executionResult.text.slice(0, 600)
    });

    emitStage(options, { stage: 'verify', attempt, totalAttempts: maxAttempts });
    const verifyStart = Date.now();
    const verification = await runVerifyStage({
      goal,
      plan: stageContext.plan,
      execution: stageContext.execution,
      config,
      options,
      verifyRounds,
      skillsAddendum
    });
    stageContext.verify.push({ attempt, ...verification });
    await trace.event('stage_complete', {
      stage: 'verify',
      attempt,
      durationMs: Date.now() - verifyStart,
      passed: verification.passed,
      failureCategory: verification.failureCategory || null,
      verifyRounds: verification.rounds,
      commandCount: verification.results.length
    });

    if (verification.passed) {
      emitStage(options, { stage: 'summarize', attempt, totalAttempts: maxAttempts });
      const summaryStart = Date.now();
      const summaryResult = await runSummarizeStage({
        goal,
        plan: stageContext.plan,
        execution: stageContext.execution,
        verification,
        config,
        options,
        trace,
        skillsAddendum
      });
      await trace.event('stage_complete', {
        stage: 'summarize',
        durationMs: Date.now() - summaryStart,
        usage: summaryResult.usage || null,
        ok: true
      });
      await trace.event('task_complete', { ok: true });
      return { ok: true, summary: summaryResult.text, state: stageContext };
    }

    lastFailure = renderVerifyFailure(verification);
    await trace.event('retry', {
      attempt,
      nextAttempt: attempt + 1,
      failureCategory: verification.failureCategory,
      failureDetail: lastFailure.slice(0, 2000)
    });

    if (attempt < maxAttempts) {
      emitStage(options, {
        stage: 'retry',
        attempt,
        totalAttempts: maxAttempts,
        failureCategory: verification.failureCategory || 'unknown'
      });
    }
  }

  emitStage(options, { stage: 'summarize', attempt: maxAttempts, totalAttempts: maxAttempts });
  let rollbackApplied = false;
  if (options.autoRollbackOnFail) {
    rollbackApplied = await rollbackMutations(mutationStore);
    await trace.event('rollback', { applied: rollbackApplied, fileCount: mutationStore.size });
  }
  const failedSummary = await runSummarizeStage({
    goal,
    plan: stageContext.plan,
    execution: stageContext.execution,
    verification: stageContext.verify[stageContext.verify.length - 1],
    config,
    options,
    forceFailureSummary: true,
    trace,
    skillsAddendum
  });

  await trace.event('task_complete', { ok: false });
  const extra = rollbackApplied ? '\\n\\nRollback: applied (auto-rollback-on-fail)' : '';
  return { ok: false, summary: failedSummary.text + extra, state: stageContext };
}

async function runPlanningStage({ goal, config, options, skillsAddendum }) {
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
      { role: 'system', content: mergeSystem('You are a senior coding planner. Output practical plans.', skillsAddendum) },
      { role: 'user', content: prompt }
    ],
    model: options.model,
    temperature: options.temperature,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    enableTools: false,
    stream: false,
    cwd: options.cwd,
    onUsage: options.onUsage
  });

  return {
    text: (result.text || '').trim(),
    usage: result.usage || null
  };
}

async function runExecuteStage({ goal, plan, lastFailure, config, options, skillsAddendum, mutationStore }) {
  const retryContext = lastFailure
    ? `Previous verification failed:\n${lastFailure}\nAddress these failures first, then continue.`
    : '';
  const execPrompt = [
    `Goal:\n${goal}`,
    `Plan:\n${plan}`,
    retryContext,
    'Execute the task using tools. Make concrete file changes and run needed commands.',
    'Prefer apply_patch for precise edits and keep changes focused.',
    'When complete, report: changed files, what changed, and why it satisfies the goal.'
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await runAgentCompletion({
    config,
    messages: [
      {
        role: 'system',
        content: mergeSystem(
          'You are ovopre execution engine. Use tools aggressively to complete the task. Prefer apply_patch for precise multi-file edits.',
          skillsAddendum
        )
      },
      { role: 'user', content: execPrompt }
    ],
    model: options.model,
    temperature: options.temperature,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    enableTools: options.enableTools !== false,
    stream: false,
    maxToolRounds: options.maxToolRounds,
    cwd: options.cwd,
    toolContext: { mutationStore },
    onUsage: options.onUsage,
    onToolCallStart: options.onToolCallStart,
    onToolCallEnd: options.onToolCallEnd,
    onRoundStart: options.onRoundStart
  });

  return {
    text: (result.text || '').trim(),
    usage: result.usage || null,
    toolCalls: result.toolCalls || 0
  };
}

async function runVerifyStage({ goal, plan, execution, config, options, verifyRounds, skillsAddendum }) {
  let allResults = [];
  let lastCategory = 'unknown';

  for (let round = 1; round <= verifyRounds; round += 1) {
    const verifyPrompt = [
      `Goal:\n${goal}`,
      `Plan:\n${plan}`,
      `Execution summary:\n${execution}`,
      allResults.length ? `Previous verify outputs:\n${renderVerifyOutputs(allResults).slice(0, 2500)}` : '',
      'Return up to 4 verification shell commands.',
      'Rules: no network install, no destructive commands.',
      'Format strictly as lines: CMD: <command>'
    ]
      .filter(Boolean)
      .join('\n\n');

    const verifyPlan = await runAgentCompletion({
      config,
      messages: [
        { role: 'system', content: mergeSystem('You output shell verification commands only.', skillsAddendum) },
        { role: 'user', content: verifyPrompt }
      ],
      model: options.model,
      temperature: 0,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      enableTools: false,
      stream: false,
      cwd: options.cwd,
      onUsage: options.onUsage
    });

    const commands = parseVerifyCommands(verifyPlan.text || '');
    const effectiveCommands = commands.length ? commands : ['ls -la'];

    const roundResults = [];
    for (const command of effectiveCommands) {
      const toolResult = await executeToolCall(
        {
          function: {
            name: 'bash',
            arguments: JSON.stringify({
              command,
              timeoutMs: options.verifyTimeoutMs || options.timeoutMs || 120000
            })
          }
        },
        { cwd: options.cwd }
      );
      roundResults.push({ command, round, ...toolResult });
    }

    allResults = [...allResults, ...roundResults];
    const failed = roundResults.filter((x) => !x.ok);
    if (!failed.length) {
      return {
        passed: true,
        rounds: round,
        commands: effectiveCommands,
        results: allResults,
        failureCount: 0,
        failureCategory: null
      };
    }

    lastCategory = classifyFailures(failed);
  }

  const failed = allResults.filter((x) => !x.ok);
  return {
    passed: false,
    rounds: verifyRounds,
    commands: allResults.map((x) => x.command),
    results: allResults,
    failureCount: failed.length,
    failureCategory: lastCategory
  };
}

async function runSummarizeStage({
  goal,
  plan,
  execution,
  verification,
  config,
  options,
  forceFailureSummary = false,
  trace,
  skillsAddendum
}) {
  const verifyText = verification
    ? verification.results
        .map((r) => `- ${r.ok ? 'PASS' : 'FAIL'} [round ${r.round}] ${r.command}\n${String(r.output || '').slice(0, 1000)}`)
        .join('\n')
    : 'No verification data.';

  const prompt = [
    `Goal:\n${goal}`,
    `Plan:\n${plan}`,
    `Execution:\n${execution}`,
    `Verification:\n${verifyText}`,
    forceFailureSummary
      ? 'Verification still failed after retries. Provide a clear failure report and next fixes.'
      : 'Provide concise completion report: done items, changed files, and verification status.'
  ].join('\n\n');

  const result = await runAgentCompletion({
    config,
    messages: [
      { role: 'system', content: mergeSystem('You are a release summarizer for coding tasks.', skillsAddendum) },
      { role: 'user', content: prompt }
    ],
    model: options.model,
    temperature: options.temperature,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    enableTools: false,
    stream: false,
    cwd: options.cwd,
    onUsage: options.onUsage
  });

  await trace.event('summary_stats', {
    usage: result.usage || null,
    verificationPassed: verification?.passed || false,
    verificationFailureCategory: verification?.failureCategory || null
  });

  return {
    text: `${(result.text || '').trim()}\n\n(taskId: ${trace.taskId}, trace: ${trace.tracePath})`,
    usage: result.usage || null
  };
}

function parseVerifyCommands(text) {
  return String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('CMD:'))
    .map((line) => line.slice(4).trim())
    .filter(Boolean)
    .slice(0, 4);
}

function renderVerifyFailure(verification) {
  const failed = verification.results.filter((x) => !x.ok);
  if (!failed.length) {
    return 'Unknown verification failure.';
  }
  return failed
    .map((x) => `Command failed: ${x.command}\nOutput:\n${String(x.output || '').slice(0, 1500)}`)
    .join('\n\n');
}

function renderVerifyOutputs(results) {
  return results
    .map((x) => `- ${x.ok ? 'PASS' : 'FAIL'} ${x.command}\n${String(x.output || '').slice(0, 500)}`)
    .join('\n');
}

function classifyFailures(failedResults) {
  const text = failedResults.map((x) => `${x.command}\n${String(x.output || '')}`).join('\n').toLowerCase();
  if (text.includes('timeout') || text.includes('timed out')) {
    return 'timeout';
  }
  if (text.includes('network') || text.includes('econnrefused') || text.includes('enotfound')) {
    return 'network';
  }
  if (text.includes('test') || text.includes('jest') || text.includes('vitest') || text.includes('pytest')) {
    return 'test';
  }
  if (text.includes('lint') || text.includes('eslint') || text.includes('stylelint')) {
    return 'lint';
  }
  if (text.includes('build') || text.includes('compile') || text.includes('tsc')) {
    return 'build';
  }
  return 'unknown';
}

function mergeSystem(base, addendum) {
  return addendum ? `${base}\n\n${addendum}` : base;
}

function emitStage(options, payload) {
  if (typeof options?.onStage === 'function') {
    options.onStage(payload);
    return;
  }

  if (payload.stage === 'retry') {
    logTask(`stage> retry (${payload.failureCategory || 'unknown'})`, options);
    return;
  }

  if (payload.stage === 'execute') {
    logTask(`stage> execute (attempt ${payload.attempt}/${payload.totalAttempts})`, options);
    return;
  }

  logTask(`stage> ${payload.stage}`, options);
}

function logTask(text, options) {
  if (!options?.quiet) {
    console.log(text);
  }
}

function normalizeInt(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return Math.floor(n);
}

async function rollbackMutations(mutationStore) {
  if (!mutationStore || mutationStore.size === 0) {
    return false;
  }

  const entries = [...mutationStore.entries()];
  for (const [filePath, before] of entries.reverse()) {
    try {
      if (!before || before.exists === false) {
        await fs.rm(filePath, { force: true });
      } else {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, before.content, 'utf8');
      }
    } catch {
      // continue rollback best-effort
    }
  }
  return true;
}
