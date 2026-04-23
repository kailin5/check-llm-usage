const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUsageMetrics, summarizeProviderResult } = require('../src/usageSummary');

test('parseUsageMetrics extracts token and cost values', () => {
  const metrics = parseUsageMetrics(
    'prompt tokens: 1,200\ncompletion tokens: 300\ntotal tokens: 1,500\ncost: $0.12',
  );

  assert.deepEqual(metrics, {
    inputTokens: 1200,
    outputTokens: 300,
    totalTokens: 1500,
    estimatedCostUsd: 0.12,
  });
});

test('summarizeProviderResult marks missing command as not_installed', () => {
  const summary = summarizeProviderResult('claude', 'claude usage', {
    error: { code: 'ENOENT' },
    stderr: '',
    stdout: '',
  });

  assert.equal(summary.status, 'not_installed');
});

test('summarizeProviderResult marks shell command-not-found output as not_installed', () => {
  const summary = summarizeProviderResult('gemini', 'gemini usage', {
    error: { code: 127 },
    stderr: '/bin/sh: 1: gemini: not found',
    stdout: '',
  });

  assert.equal(summary.status, 'not_installed');
});

test('summarizeProviderResult marks generic command errors as failed', () => {
  const summary = summarizeProviderResult('copilot', 'gh copilot usage', {
    error: { code: 1 },
    stderr: 'unexpected command error',
    stdout: '',
  });

  assert.equal(summary.status, 'failed');
});

test('summarizeProviderResult keeps successful status and parses merged output metrics', () => {
  const summary = summarizeProviderResult('claude', 'claude usage', {
    stdout: 'prompt tokens: 100',
    stderr: 'total tokens: 120\ncost: $0.01',
  });

  assert.equal(summary.status, 'ok');
  assert.equal(summary.metrics.inputTokens, 100);
  assert.equal(summary.metrics.totalTokens, 120);
  assert.equal(summary.metrics.estimatedCostUsd, 0.01);
});

test('summarizeProviderResult returns no_data when exec succeeds but parses nothing', () => {
  const summary = summarizeProviderResult('gemini', 'gemini usage', {
    stdout: 'Gemini CLI — Defaults to interactive mode.',
    stderr: '',
  });

  assert.equal(summary.status, 'no_data');
  assert.equal(summary.metrics.inputTokens, null);
  assert.equal(summary.metrics.estimatedCostUsd, null);
});
