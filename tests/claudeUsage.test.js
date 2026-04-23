const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { summarizeClaudeUsage, priceFor } = require('../src/claudeUsage');

function makeProjectsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-'));
  return dir;
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
  // unknown model falls back to a sensible default
  assert.equal(priceFor('some-unknown-model').input, 3);
});

test('summarizeClaudeUsage aggregates tokens and estimates cost across sessions', () => {
  const projectsDir = makeProjectsDir();
  try {
    writeSession(projectsDir, 'proj-a', 'sess1', [
      { type: 'user', content: 'ignored' },
      {
        type: 'assistant',
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

    const summary = summarizeClaudeUsage({ projectsDir });

    assert.equal(summary.status, 'ok');
    assert.equal(summary.metrics.inputTokens, 300);
    assert.equal(summary.metrics.outputTokens, 350);
    // total = input + output + cacheRead + cacheWrite
    assert.equal(summary.metrics.totalTokens, 300 + 350 + 1000 + 10);
    // opus: (100*15 + 50*75 + 1000*1.5 + 10*18.75) / 1e6
    // sonnet: (200*3 + 300*15) / 1e6
    const expected =
      (100 * 15 + 50 * 75 + 1000 * 1.5 + 10 * 18.75 + 200 * 3 + 300 * 15) / 1_000_000;
    assert.equal(summary.metrics.estimatedCostUsd, Number(expected.toFixed(4)));
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('summarizeClaudeUsage returns no_data when the projects dir is missing', () => {
  const summary = summarizeClaudeUsage({
    projectsDir: path.join(os.tmpdir(), 'definitely-not-a-real-dir-xyz123'),
  });
  assert.equal(summary.status, 'no_data');
  assert.equal(summary.metrics.inputTokens, null);
});

test('summarizeClaudeUsage skips malformed JSONL lines', () => {
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

    const summary = summarizeClaudeUsage({ projectsDir });
    assert.equal(summary.status, 'ok');
    assert.equal(summary.metrics.inputTokens, 10);
    assert.equal(summary.metrics.outputTokens, 20);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});
