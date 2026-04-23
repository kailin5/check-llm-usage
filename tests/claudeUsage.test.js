const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { summarizeClaudeUsage, priceFor, resolveLimits, formatResetsIn } = require('../src/claudeUsage');

function makeProjectsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-'));
}

function writeSession(projectsDir, project, sessionId, lines) {
  const projectDir = path.join(projectsDir, project);
  fs.mkdirSync(projectDir, { recursive: true });
  const file = path.join(projectDir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

test('priceFor matches model id by longest prefix', () => {
  assert.equal(priceFor('claude-opus-4-7').input, 15);
  assert.equal(priceFor('claude-sonnet-4-6').input, 3);
  assert.equal(priceFor('claude-haiku-4-5-20251001').input, 1);
  assert.equal(priceFor('some-unknown-model').input, 3);
});

test('summarizeClaudeUsage aggregates tokens and estimates cost across sessions', async () => {
  const projectsDir = makeProjectsDir();
  try {
    writeSession(projectsDir, 'proj-a', 'sess1', [
      { type: 'user', content: 'ignored' },
      {
        type: 'assistant',
        timestamp: new Date().toISOString(),
        message: {
          model: 'claude-opus-4-7',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 1000,
            cache_creation_input_tokens: 10,
          },
        },
      },
    ]);
    writeSession(projectsDir, 'proj-b', 'sess2', [
      {
        type: 'assistant',
        timestamp: new Date().toISOString(),
        message: {
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 200,
            output_tokens: 300,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
    ]);

    const summary = await summarizeClaudeUsage({ projectsDir });

    assert.equal(summary.status, 'ok');
    assert.equal(summary.metrics.inputTokens, 300);
    assert.equal(summary.metrics.outputTokens, 350);
    assert.equal(summary.metrics.totalTokens, 300 + 350 + 1000 + 10);
    const expected =
      (100 * 15 + 50 * 75 + 1000 * 1.5 + 10 * 18.75 + 200 * 3 + 300 * 15) / 1_000_000;
    assert.equal(summary.metrics.estimatedCostUsd, Number(expected.toFixed(4)));
    // Recent timestamps → both windowed buckets should match lifetime.
    assert.equal(summary.metrics.cost5h, Number(expected.toFixed(4)));
    assert.equal(summary.metrics.cost7d, Number(expected.toFixed(4)));
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('summarizeClaudeUsage excludes old timestamps from windowed costs', async () => {
  const projectsDir = makeProjectsDir();
  try {
    const oldTs = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    writeSession(projectsDir, 'proj', 'old', [
      {
        type: 'assistant',
        timestamp: oldTs,
        message: {
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 1000, output_tokens: 1000 },
        },
      },
    ]);

    const summary = await summarizeClaudeUsage({ projectsDir });
    assert.equal(summary.status, 'ok');
    assert.ok(summary.metrics.estimatedCostUsd > 0);
    assert.equal(summary.metrics.cost5h, 0);
    assert.equal(summary.metrics.cost7d, 0);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('summarizeClaudeUsage returns no_data when the projects dir is missing', async () => {
  const summary = await summarizeClaudeUsage({
    projectsDir: path.join(os.tmpdir(), 'definitely-not-a-real-dir-xyz123'),
  });
  assert.equal(summary.status, 'no_data');
  assert.equal(summary.metrics.inputTokens, null);
});

test('resolveLimits returns Pro defaults and honors env overrides', () => {
  const pro = resolveLimits({ CLAUDE_PLAN: 'pro' });
  assert.equal(pro.session, 35);
  assert.equal(pro.weekly, 95);
  assert.equal(pro.opusWeekly, 70);

  const override = resolveLimits({
    CLAUDE_PLAN: 'pro',
    CLAUDE_SESSION_LIMIT_USD: '50',
    CLAUDE_OPUS_WEEKLY_LIMIT_USD: '120',
  });
  assert.equal(override.session, 50);
  assert.equal(override.weekly, 95);
  assert.equal(override.opusWeekly, 120);

  const none = resolveLimits({});
  assert.equal(none.session, null);
  assert.equal(none.weekly, null);
  assert.equal(none.opusWeekly, null);
});

test('formatResetsIn rounds to hours and minutes', () => {
  assert.equal(formatResetsIn(2 * 60 * 60 * 1000 + 45 * 60 * 1000), '2 hr 45 min');
  assert.equal(formatResetsIn(12 * 60 * 1000), '12 min');
  assert.equal(formatResetsIn(0), null);
  assert.equal(formatResetsIn(null), null);
});

test('summarizeClaudeUsage computes percentages and session reset window', async () => {
  const projectsDir = makeProjectsDir();
  try {
    // Message 2 hours ago → 3 hours left in the 5h window.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    writeSession(projectsDir, 'proj', 'sess', [
      {
        type: 'assistant',
        timestamp: twoHoursAgo,
        message: {
          model: 'claude-opus-4-7',
          // crafted so this costs exactly $3.50 at our opus pricing:
          // 100k input tokens * $15/M = $1.50; 40k output * $75/M = $3.00; overshoot
          // simpler: 1000 input * 15 + 2000 output * 75 = 15000 + 150000 = 165000 / 1e6 = $0.165
          usage: { input_tokens: 100_000, output_tokens: 40_000 },
        },
      },
    ]);

    const summary = await summarizeClaudeUsage({
      projectsDir,
      env: { CLAUDE_PLAN: 'pro' },
    });

    // cost5h = 100000 * 15/1e6 + 40000 * 75/1e6 = 1.5 + 3.0 = $4.50
    assert.equal(summary.metrics.cost5h, 4.5);
    // 4.5 of 35 = 12.857% → rounds to 13%
    assert.equal(summary.metrics.sessionPct, 13);
    // Resets in roughly 3 hours (±2 minutes); check a band to avoid flakes.
    assert.match(summary.metrics.sessionResetsIn, /^2 hr 5[89] min$|^3 hr 0 min$/);
    assert.equal(summary.metrics.limits.session, 35);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('summarizeClaudeUsage skips malformed JSONL lines', async () => {
  const projectsDir = makeProjectsDir();
  try {
    const projectDir = path.join(projectsDir, 'proj');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(
      path.join(projectDir, 'sess.jsonl'),
      [
        '{not valid json}',
        '',
        JSON.stringify({
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5',
            usage: { input_tokens: 10, output_tokens: 20 },
          },
        }),
      ].join('\n'),
    );

    const summary = await summarizeClaudeUsage({ projectsDir });
    assert.equal(summary.status, 'ok');
    assert.equal(summary.metrics.inputTokens, 10);
    assert.equal(summary.metrics.outputTokens, 20);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});
