function getProviders(env = process.env) {
  return [
    {
      name: 'claude',
      command: env.CLAUDE_USAGE_CMD || 'claude usage',
    },
    {
      name: 'gemini',
      command: env.GEMINI_USAGE_CMD || 'gemini usage',
    },
    {
      name: 'copilot',
      command: env.COPILOT_USAGE_CMD || 'gh copilot usage',
    },
    {
      name: 'openai',
      command: env.OPENAI_USAGE_CMD || 'openai api usage',
    },
    {
      name: 'groq',
      command: env.GROQ_USAGE_CMD || 'groq usage',
    },
    {
      name: 'perplexity',
      command: env.PERPLEXITY_USAGE_CMD || 'pplx usage',
    },
  ];
}

module.exports = {
  getProviders,
};
