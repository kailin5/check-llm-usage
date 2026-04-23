const test = require('node:test');
const assert = require('node:assert/strict');
const { getProviders } = require('../src/providers');

test('getProviders includes expanded default providers', () => {
  const providers = getProviders({});

  assert.deepEqual(
    providers.map((provider) => provider.name),
    ['claude', 'gemini', 'copilot', 'openai', 'groq', 'perplexity'],
  );
});

test('getProviders applies environment command overrides', () => {
  const providers = getProviders({
    OPENAI_USAGE_CMD: 'custom-openai usage',
    GROQ_USAGE_CMD: 'custom-groq usage',
  });

  const openai = providers.find((provider) => provider.name === 'openai');
  const groq = providers.find((provider) => provider.name === 'groq');

  assert.equal(openai.command, 'custom-openai usage');
  assert.equal(groq.command, 'custom-groq usage');
});
