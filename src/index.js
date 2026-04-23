const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const { summarizeProviderResult } = require('./usageSummary');

const execAsync = promisify(exec);

const PROVIDERS = [
  {
    name: 'claude',
    command: process.env.CLAUDE_USAGE_CMD || 'claude usage',
  },
  {
    name: 'gemini',
    command: process.env.GEMINI_USAGE_CMD || 'gemini usage',
  },
  {
    name: 'copilot',
    command: process.env.COPILOT_USAGE_CMD || 'gh copilot usage',
  },
];

async function runProvider(provider) {
  try {
    const output = await execAsync(provider.command, {
      timeout: 30_000,
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

function formatMetrics(metrics) {
  const cost = metrics.estimatedCostUsd === null ? '-' : `$${metrics.estimatedCostUsd.toFixed(4)}`;
  return {
    input: metrics.inputTokens ?? '-',
    output: metrics.outputTokens ?? '-',
    total: metrics.totalTokens ?? '-',
    cost,
  };
}

function printSummary(results) {
  console.log('LLM Usage Summary');
  console.log('=================');

  for (const result of results) {
    const metrics = formatMetrics(result.metrics);
    console.log(`- ${result.provider}: ${result.status}`);
    console.log(`  command: ${result.command}`);
    console.log(`  input_tokens: ${metrics.input}`);
    console.log(`  output_tokens: ${metrics.output}`);
    console.log(`  total_tokens: ${metrics.total}`);
    console.log(`  est_cost_usd: ${metrics.cost}`);
  }
}

async function main() {
  const results = [];

  for (const provider of PROVIDERS) {
    results.push(await runProvider(provider));
  }

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
