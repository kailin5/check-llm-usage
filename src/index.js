#!/usr/bin/env node
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const { summarizeProviderResult } = require('./usageSummary');
const { getProviders } = require('./providers');
const { summarizeClaudeUsage } = require('./claudeUsage');
const { summarizeGeminiUsage } = require('./geminiUsage');

const execAsync = promisify(exec);
const commandTimeoutMs = Number.parseInt(process.env.LLM_USAGE_TIMEOUT_MS || '', 10) || 30_000;

async function runProvider(provider) {
  if (provider.builtin && provider.name === 'claude') {
    try {
      return await summarizeClaudeUsage();
    } catch (error) {
      return builtinError('claude', provider.command, error);
    }
  }

  if (provider.builtin && provider.name === 'gemini') {
    try {
      return await summarizeGeminiUsage();
    } catch (error) {
      return builtinError('gemini', provider.command, error);
    }
  }

  try {
    const output = await execAsync(provider.command, {
      timeout: commandTimeoutMs,
      maxBuffer: 1024 * 1024,
    });

    return summarizeProviderResult(provider.name, provider.command, {
      stdout: output.stdout,
      stderr: output.stderr,
    });
  } catch (error) {
    return summarizeProviderResult(provider.name, provider.command, {
      stdout: error.stdout,
      stderr: error.stderr,
      error,
    });
  }
}

function builtinError(name, command, error) {
  return {
    provider: name,
    command,
    status: 'failed',
    metrics: {},
    output: String(error?.message || error),
  };
}

const NOT_DETECTED_STATUSES = new Set(['not_installed', 'no_data', 'failed']);

function formatMoney(value) {
  return value === null || value === undefined ? '-' : `$${Number(value).toFixed(4)}`;
}

function printClaudeBlock(result) {
  // Mirrors Claude Code's `/usage` slash command. % used is only shown when a
  // plan's limits are known (via CLAUDE_PLAN=pro or explicit *_LIMIT_USD env
  // vars). Weekly is rolling 7 days — the real /usage inside Claude Code
  // anchors weekly resets to a specific weekday which we can't know from disk.
  const m = result.metrics || {};
  const limits = m.limits || {};

  console.log('- claude: ok');
  if (m.latestModel) console.log(`  current_model: ${m.latestModel}`);

  const pctStr = (pct) => (pct == null ? null : `${pct}% used`);
  const bucketLine = (pct, used, limit) => {
    const usedStr = formatMoney(used);
    if (limit) return `${pctStr(pct)} (${usedStr} of ~$${limit.toFixed(2)})`;
    return `${usedStr} used`;
  };

  console.log('');
  console.log('  Current session (5h window)');
  if (m.sessionResetsIn) console.log(`    Resets in ${m.sessionResetsIn}`);
  console.log(`    ${bucketLine(m.sessionPct, m.cost5h, limits.session)}`);

  console.log('');
  console.log('  Weekly (rolling 7d)');
  if (m.weeklyResetsIn) console.log(`    Rolling-window end in ${m.weeklyResetsIn}`);
  console.log(`    All models:  ${bucketLine(m.weeklyPct, m.cost7d, limits.weekly)}`);
  console.log(`    Opus only:   ${bucketLine(m.opusWeeklyPct, m.opusCost7d, limits.opusWeekly)}`);

  console.log('');
  console.log(`  Lifetime cost: ${formatMoney(m.estimatedCostUsd)}`);
  if (!limits.session && !limits.weekly && !limits.opusWeekly) {
    console.log('');
    console.log('  (Set CLAUDE_PLAN=pro, or CLAUDE_SESSION_LIMIT_USD /');
    console.log('   CLAUDE_WEEKLY_LIMIT_USD / CLAUDE_OPUS_WEEKLY_LIMIT_USD,');
    console.log('   to see "% used" against your plan.)');
  }
}

function printGeminiBlock(result) {
  // Mirrors Gemini CLI's `/model` slash command: just the currently selected
  // model. The CLI doesn't persist token usage on disk.
  console.log('- gemini: ok');
  console.log(`  current_model: ${result.metrics.model}`);
}

function printGenericBlock(result) {
  const m = result.metrics || {};
  console.log(`- ${result.provider}: ${result.status}`);
  console.log(`  command: ${result.command}`);
  if (m.inputTokens != null) {
    console.log(`  input_tokens:  ${m.inputTokens}`);
    console.log(`  output_tokens: ${m.outputTokens}`);
    console.log(`  total_tokens:  ${m.totalTokens}`);
  }
  if (m.estimatedCostUsd != null) {
    console.log(`  est_cost_usd:  ${formatMoney(m.estimatedCostUsd)}`);
  }
}

function printSummary(results) {
  console.log('LLM Usage Summary');
  console.log('=================');

  const notDetected = [];

  for (const result of results) {
    // Gemini with no configured model → lump into the not-detected line.
    const isEmptyGemini = result.provider === 'gemini' && !result.metrics?.model;

    if (NOT_DETECTED_STATUSES.has(result.status) || isEmptyGemini) {
      notDetected.push(result.provider);
      continue;
    }

    if (result.provider === 'claude') {
      printClaudeBlock(result);
    } else if (result.provider === 'gemini') {
      printGeminiBlock(result);
    } else {
      printGenericBlock(result);
    }
  }

  if (notDetected.length > 0) {
    console.log('');
    console.log(`Not detected on your system: ${notDetected.join(', ')}`);
  }
}

async function main() {
  const providers = getProviders();
  const results = await Promise.all(providers.map(runProvider));

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
    return;
  }

  printSummary(results);
}

main().catch((error) => {
  console.error('Failed to check LLM usage:', error);
  process.exitCode = 1;
});
