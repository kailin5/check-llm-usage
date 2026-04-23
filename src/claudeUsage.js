const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// USD per 1M tokens. Matched by longest-prefix against the model id on the
// assistant message. Keep these conservative — a rough estimate is enough for
// a usage dashboard; authoritative billing lives in the Anthropic console.
const MODEL_PRICING = [
  { prefix: 'claude-opus',   input: 15,  output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  { prefix: 'claude-sonnet', input: 3,   output: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  { prefix: 'claude-haiku',  input: 1,   output: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
];

const DEFAULT_PRICING = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

function priceFor(model) {
  if (!model) return DEFAULT_PRICING;
  const match = MODEL_PRICING.find((p) => model.startsWith(p.prefix));
  return match || DEFAULT_PRICING;
}

function defaultProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects');
}

function listJsonlFiles(projectsDir) {
  if (!fs.existsSync(projectsDir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(projectsDir, entry.name);
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.jsonl')) files.push(path.join(dir, f));
    }
  }
  return files;
}

function aggregateFile(filePath, totals) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type !== 'assistant') continue;
    const msg = record.message;
    const usage = msg?.usage;
    if (!usage) continue;

    const input = usage.input_tokens || 0;
    const output = usage.output_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    const price = priceFor(msg.model);

    totals.inputTokens += input;
    totals.outputTokens += output;
    totals.cacheReadTokens += cacheRead;
    totals.cacheWriteTokens += cacheWrite;
    totals.estimatedCostUsd +=
      (input * price.input +
        output * price.output +
        cacheRead * price.cacheRead +
        cacheWrite * price.cacheWrite) / 1_000_000;
    totals.assistantMessages += 1;
  }
}

function summarizeClaudeUsage({ projectsDir = defaultProjectsDir() } = {}) {
  const files = listJsonlFiles(projectsDir);

  if (files.length === 0) {
    return {
      provider: 'claude',
      command: `read ${projectsDir}`,
      status: 'no_data',
      metrics: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        estimatedCostUsd: null,
      },
      output: `No Claude Code session logs found under ${projectsDir}`,
    };
  }

  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0,
    assistantMessages: 0,
  };

  for (const file of files) {
    try {
      aggregateFile(file, totals);
    } catch {
      // skip unreadable files
    }
  }

  const totalTokens =
    totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;

  return {
    provider: 'claude',
    command: `read ${projectsDir}`,
    status: totals.assistantMessages > 0 ? 'ok' : 'no_data',
    metrics: {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      totalTokens,
      estimatedCostUsd: Number(totals.estimatedCostUsd.toFixed(4)),
    },
    output: `Aggregated ${totals.assistantMessages} assistant messages across ${files.length} session log(s) (cache read: ${totals.cacheReadTokens}, cache write: ${totals.cacheWriteTokens})`,
  };
}

module.exports = {
  summarizeClaudeUsage,
  defaultProjectsDir,
  priceFor,
};
