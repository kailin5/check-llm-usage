const fsPromises = require('node:fs/promises');
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

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Rough Pro-plan limits inferred from calibration against a user's /usage
// screenshot (see README). Pro uses "token-equivalent units" internally, which
// map to API pricing to within roughly ±10%. Users on other plans should set
// the env vars directly.
const PLAN_DEFAULTS = {
  pro: { session: 35, weekly: 95, opusWeekly: 70 },
};

function resolveLimits(env = process.env) {
  const plan = (env.CLAUDE_PLAN || '').toLowerCase();
  const base = PLAN_DEFAULTS[plan] || {};
  const pick = (envVal, fallback) => {
    const n = Number(envVal);
    return Number.isFinite(n) && n > 0 ? n : (fallback ?? null);
  };
  return {
    plan: plan || null,
    session: pick(env.CLAUDE_SESSION_LIMIT_USD, base.session),
    weekly: pick(env.CLAUDE_WEEKLY_LIMIT_USD, base.weekly),
    opusWeekly: pick(env.CLAUDE_OPUS_WEEKLY_LIMIT_USD, base.opusWeekly),
  };
}

function priceFor(model) {
  if (!model) return DEFAULT_PRICING;
  const match = MODEL_PRICING.find((p) => model.startsWith(p.prefix));
  return match || DEFAULT_PRICING;
}

function defaultProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects');
}

async function listJsonlFiles(projectsDir) {
  let topEntries;
  try {
    topEntries = await fsPromises.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  await Promise.all(
    topEntries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const dir = path.join(projectsDir, e.name);
        let children;
        try {
          children = await fsPromises.readdir(dir);
        } catch {
          return;
        }
        for (const f of children) {
          if (f.endsWith('.jsonl')) files.push(path.join(dir, f));
        }
      }),
  );
  return files;
}

async function aggregateFile(filePath, totals, nowMs) {
  let content;
  try {
    content = await fsPromises.readFile(filePath, 'utf8');
  } catch {
    return;
  }

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
    const lineCost =
      (input * price.input +
        output * price.output +
        cacheRead * price.cacheRead +
        cacheWrite * price.cacheWrite) / 1_000_000;
    const isOpus = (msg.model || '').startsWith('claude-opus');

    totals.inputTokens += input;
    totals.outputTokens += output;
    totals.cacheReadTokens += cacheRead;
    totals.cacheWriteTokens += cacheWrite;
    totals.estimatedCostUsd += lineCost;
    totals.assistantMessages += 1;

    const ts = record.timestamp ? Date.parse(record.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      const age = nowMs - ts;
      if (age <= FIVE_HOURS_MS) {
        totals.cost5h += lineCost;
        if (isOpus) totals.opusCost5h += lineCost;
        if (!totals.earliestTs5h || ts < totals.earliestTs5h) totals.earliestTs5h = ts;
      }
      if (age <= SEVEN_DAYS_MS) {
        totals.cost7d += lineCost;
        if (isOpus) totals.opusCost7d += lineCost;
        if (!totals.earliestTs7d || ts < totals.earliestTs7d) totals.earliestTs7d = ts;
      }
      if (!totals.latestTs || ts > totals.latestTs) {
        totals.latestTs = ts;
        totals.latestModel = msg.model || null;
      }
    }
  }
}

function formatResetsIn(ms) {
  if (ms === null || ms === undefined || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return `${h} hr ${m} min`;
}

async function summarizeClaudeUsage({
  projectsDir = defaultProjectsDir(),
  env = process.env,
  now = Date.now(),
} = {}) {
  const files = await listJsonlFiles(projectsDir);
  const limits = resolveLimits(env);

  if (files.length === 0) {
    return {
      provider: 'claude',
      command: `read ${projectsDir}`,
      status: 'no_data',
      metrics: emptyMetrics(limits),
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
    cost5h: 0,
    cost7d: 0,
    opusCost5h: 0,
    opusCost7d: 0,
    earliestTs5h: 0,
    earliestTs7d: 0,
    latestTs: 0,
    latestModel: null,
  };

  await Promise.all(files.map((file) => aggregateFile(file, totals, now)));

  const totalTokens =
    totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;

  const sessionResetAt = totals.earliestTs5h ? totals.earliestTs5h + FIVE_HOURS_MS : null;
  const weeklyResetAt = totals.earliestTs7d ? totals.earliestTs7d + SEVEN_DAYS_MS : null;

  const pct = (value, limit) =>
    limit && value != null ? Math.round((value / limit) * 100) : null;

  return {
    provider: 'claude',
    command: `read ${projectsDir}`,
    status: totals.assistantMessages > 0 ? 'ok' : 'no_data',
    metrics: {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      totalTokens,
      estimatedCostUsd: round(totals.estimatedCostUsd),
      cost5h: round(totals.cost5h),
      cost7d: round(totals.cost7d),
      opusCost5h: round(totals.opusCost5h),
      opusCost7d: round(totals.opusCost7d),
      latestModel: totals.latestModel,
      sessionResetsInMs: sessionResetAt ? Math.max(0, sessionResetAt - now) : null,
      sessionResetsIn: sessionResetAt ? formatResetsIn(sessionResetAt - now) : null,
      weeklyResetsInMs: weeklyResetAt ? Math.max(0, weeklyResetAt - now) : null,
      weeklyResetsIn: weeklyResetAt ? formatResetsIn(weeklyResetAt - now) : null,
      sessionPct: pct(totals.cost5h, limits.session),
      weeklyPct: pct(totals.cost7d, limits.weekly),
      opusWeeklyPct: pct(totals.opusCost7d, limits.opusWeekly),
      limits,
    },
    output: `Aggregated ${totals.assistantMessages} assistant messages across ${files.length} session log(s)`,
  };
}

function round(n) {
  return Number(n.toFixed(4));
}

function emptyMetrics(limits) {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    estimatedCostUsd: null,
    cost5h: null,
    cost7d: null,
    opusCost5h: null,
    opusCost7d: null,
    latestModel: null,
    sessionResetsInMs: null,
    sessionResetsIn: null,
    weeklyResetsInMs: null,
    weeklyResetsIn: null,
    sessionPct: null,
    weeklyPct: null,
    opusWeeklyPct: null,
    limits,
  };
}

module.exports = {
  summarizeClaudeUsage,
  defaultProjectsDir,
  priceFor,
  resolveLimits,
  formatResetsIn,
};
