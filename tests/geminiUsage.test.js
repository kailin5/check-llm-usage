const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { summarizeGeminiUsage, priceFor, resolveLimits, formatResetsIn } = require('../src/geminiUsage');

function makeProjectsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-usage-'));
}

function writeSession(projectsDir, project, sessionId, lines) {
  const chatsDir = path.join(projectsDir, project, 'chats');
  fs.mkdirSync(chatsDir, { recursive: true });
  const file = path.join(chatsDir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

test('priceFor matches model id by longest prefix', () => {
  assert.equal(priceFor('gemini-1.5-pro-preview').input, 1.25);
  assert.equal(priceFor('gemini-1.5-flash-xyz').input, 0.075);
  assert.equal(priceFor('gemini-2.0-pro-exp').input, 1.25);
  assert.equal(priceFor('gemini-3.1-pro-xyz').input, 1.25);
  assert.equal(priceFor('some-unknown-model').input, 1.25); // default
});

test('summarizeGeminiUsage aggregates tokens and estimates cost across sessions', async () => {
  const projectsDir = makeProjectsDir();
  try {
    writeSession(projectsDir, 'proj-a', 'sess1', [
      { type: 'user', content: 'ignored' },
      {
        type: 'gemini',
        timestamp: new Date().toISOString(),
        model: 'gemini-1.5-pro',
        tokens: {
          input: 100,
          output: 50,
          cached: 1000,
        },
      },
    ]);
    writeSession(projectsDir, 'proj-b', 'sess2', [
      {
        type: 'gemini',
        timestamp: new Date().toISOString(),
        model: 'gemini-1.5-flash',
        tokens: {
          input: 200,
          output: 300,
          cached: 0,
        },
      },
    ]);

    const summary = await summarizeGeminiUsage({ projectsDir });

    assert.equal(summary.status, 'ok');
    assert.equal(summary.metrics.inputTokens, 300);
    assert.equal(summary.metrics.outputTokens, 350);
    assert.equal(summary.metrics.totalTokens, 300 + 350 + 1000);
    const expected =
      (100 * 1.25 + 50 * 3.75 + 1000 * 0.3125 + 200 * 0.075 + 300 * 0.3) / 1_000_000;
    assert.equal(summary.metrics.estimatedCostUsd, Number(expected.toFixed(4)));
    assert.equal(summary.metrics.cost24h, Number(expected.toFixed(4)));
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('summarizeGeminiUsage excludes old timestamps from windowed costs', async () => {
  const projectsDir = makeProjectsDir();
  try {
    const oldTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeSession(projectsDir, 'proj', 'old', [
      {
        type: 'gemini',
        timestamp: oldTs,
        model: 'gemini-1.5-flash',
        tokens: { input: 1000, output: 1000, cached: 0 },
      },
    ]);

    const summary = await summarizeGeminiUsage({ projectsDir });
    assert.equal(summary.status, 'ok');
    assert.ok(summary.metrics.estimatedCostUsd > 0);
    assert.equal(summary.metrics.cost24h, 0);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('summarizeGeminiUsage returns no_data when the projects dir is missing', async () => {
  const summary = await summarizeGeminiUsage({
    projectsDir: path.join(os.tmpdir(), 'definitely-not-a-real-dir-xyz123'),
  });
  assert.equal(summary.status, 'no_data');
  assert.equal(summary.metrics.inputTokens, null);
});

test('resolveLimits returns plan defaults and honors env overrides', () => {
  const advanced = resolveLimits({ GEMINI_PLAN: 'advanced' });
  assert.equal(advanced.daily, 10);

  const override = resolveLimits({
    GEMINI_PLAN: 'advanced',
    GEMINI_DAILY_LIMIT_USD: '50',
  });
  assert.equal(override.daily, 50);

  const none = resolveLimits({});
  assert.equal(none.daily, null);
});

test('formatResetsIn rounds to hours and minutes', () => {
  assert.equal(formatResetsIn(2 * 60 * 60 * 1000 + 45 * 60 * 1000), '2 hr 45 min');
  assert.equal(formatResetsIn(12 * 60 * 1000), '12 min');
  assert.equal(formatResetsIn(0), null);
  assert.equal(formatResetsIn(null), null);
});

test('summarizeGeminiUsage skips malformed JSONL lines', async () => {
  const projectsDir = makeProjectsDir();
  try {
    const chatsDir = path.join(projectsDir, 'proj', 'chats');
    fs.mkdirSync(chatsDir, { recursive: true });
    fs.writeFileSync(
      path.join(chatsDir, 'sess.jsonl'),
      [
        '{not valid json}',
        '',
        JSON.stringify({
          type: 'gemini',
          model: 'gemini-1.5-flash',
          tokens: { input: 10, output: 20 },
        }),
      ].join('\n'),
    );

    const summary = await summarizeGeminiUsage({ projectsDir });
    assert.equal(summary.status, 'ok');
    assert.equal(summary.metrics.inputTokens, 10);
    assert.equal(summary.metrics.outputTokens, 20);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});
