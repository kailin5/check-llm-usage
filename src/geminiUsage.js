const fsPromises = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// USD per 1M tokens. Matched by longest-prefix against the model id.
const MODEL_PRICING = [
  { prefix: 'gemini-1.5-pro', input: 1.25, output: 3.75, cacheRead: 0.3125, cacheWrite: 0 },
  { prefix: 'gemini-1.5-flash', input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0 },
  { prefix: 'gemini-2.0-pro', input: 1.25, output: 3.75, cacheRead: 0.3125, cacheWrite: 0 },
  { prefix: 'gemini-2.0-flash', input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 },
  { prefix: 'gemini-3.1-pro', input: 1.25, output: 3.75, cacheRead: 0.3125, cacheWrite: 0 },
];

const DEFAULT_PRICING = { input: 1.25, output: 3.75, cacheRead: 0.3125, cacheWrite: 0 };

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// E.g., advanced plan limits
const PLAN_DEFAULTS = {
  advanced: { daily: 10 },
};

function resolveLimits(env = process.env) {
  const plan = (env.GEMINI_PLAN || '').toLowerCase();
  const base = PLAN_DEFAULTS[plan] || {};
  const pick = (envVal, fallback) => {
    const n = Number(envVal);
    return Number.isFinite(n) && n > 0 ? n : (fallback ?? null);
  };
  return {
    plan: plan || null,
    daily: pick(env.GEMINI_DAILY_LIMIT_USD, base.daily),
  };
}

function priceFor(model) {
  if (!model) return DEFAULT_PRICING;
  const match = MODEL_PRICING.find((p) => model.startsWith(p.prefix));
  return match || DEFAULT_PRICING;
}

function defaultProjectsDir() {
  return path.join(os.homedir(), '.gemini', 'tmp');
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
        const chatsDir = path.join(projectsDir, e.name, 'chats');
        let children;
        try {
          children = await fsPromises.readdir(chatsDir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const child of children) {
          const childPath = path.join(chatsDir, child.name);
          if (child.isDirectory()) {
            let subChildren;
            try {
              subChildren = await fsPromises.readdir(childPath);
            } catch {
              continue;
            }
            for (const subF of subChildren) {
              if (subF.endsWith('.jsonl')) files.push(path.join(childPath, subF));
            }
          } else if (child.isFile() && child.name.endsWith('.jsonl')) {
            files.push(childPath);
          }
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
    if (record.type !== 'gemini') continue;
    const tokens = record.tokens;
    if (!tokens) continue;

    const input = tokens.input || 0;
    const output = tokens.output || 0;
    const cacheRead = tokens.cached || 0;
    const cacheWrite = 0;
    const price = priceFor(record.model);
    const lineCost =
      (input * price.input +
        output * price.output +
        cacheRead * price.cacheRead +
        cacheWrite * price.cacheWrite) / 1_000_000;

    totals.inputTokens += input;
    totals.outputTokens += output;
    totals.cacheReadTokens += cacheRead;
    totals.cacheWriteTokens += cacheWrite;
    totals.estimatedCostUsd += lineCost;
    totals.assistantMessages += 1;

    const ts = record.timestamp ? Date.parse(record.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      const age = nowMs - ts;
      if (age <= ONE_DAY_MS) {
        totals.cost24h += lineCost;
        if (!totals.earliestTs24h || ts < totals.earliestTs24h) totals.earliestTs24h = ts;
      }
      if (!totals.latestTs || ts > totals.latestTs) {
        totals.latestTs = ts;
        totals.latestModel = record.model || null;
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

async function summarizeGeminiUsage({
  projectsDir = defaultProjectsDir(),
  env = process.env,
  now = Date.now(),
} = {}) {
  const files = await listJsonlFiles(projectsDir);
  const limits = resolveLimits(env);

  if (files.length === 0) {
    return {
      provider: 'gemini',
      command: `read ${projectsDir}`,
      status: 'no_data',
      metrics: emptyMetrics(limits),
      output: `No Gemini session logs found under ${projectsDir}`,
    };
  }

  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0,
    assistantMessages: 0,
    cost24h: 0,
    earliestTs24h: 0,
    latestTs: 0,
    latestModel: null,
  };

  await Promise.all(files.map((file) => aggregateFile(file, totals, now)));

  const totalTokens =
    totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;

  const dailyResetAt = totals.earliestTs24h ? totals.earliestTs24h + ONE_DAY_MS : null;

  const pct = (value, limit) =>
    limit && value != null ? Math.round((value / limit) * 100) : null;

  return {
    provider: 'gemini',
    command: `read ${projectsDir}`,
    status: totals.assistantMessages > 0 ? 'ok' : 'no_data',
    metrics: {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      totalTokens,
      estimatedCostUsd: round(totals.estimatedCostUsd),
      cost24h: round(totals.cost24h),
      latestModel: totals.latestModel,
      dailyResetsInMs: dailyResetAt ? Math.max(0, dailyResetAt - now) : null,
      dailyResetsIn: dailyResetAt ? formatResetsIn(dailyResetAt - now) : null,
      dailyPct: pct(totals.cost24h, limits.daily),
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
    cost24h: null,
    latestModel: null,
    dailyResetsInMs: null,
    dailyResetsIn: null,
    dailyPct: null,
    limits,
  };
}

module.exports = {
  summarizeGeminiUsage,
  defaultProjectsDir,
  priceFor,
  resolveLimits,
  formatResetsIn,
};