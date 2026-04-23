// TODO: the default commands for copilot/openai/groq/perplexity below are
// placeholders — none of those CLIs actually expose a `usage` subcommand
// today. Users can override via the *_USAGE_CMD env vars, but out-of-the-box
// these will be reported as "not detected". Real implementations (e.g. API-
// based polling or log parsing per provider) are tracked separately.
function getProviders(env = process.env) {
  return [
    {
      name: 'claude',
      // Handled specially in src/index.js by reading ~/.claude/projects/*.jsonl.
      // Setting CLAUDE_USAGE_CMD forces the exec path instead.
      command: env.CLAUDE_USAGE_CMD || 'claude usage',
      builtin: !env.CLAUDE_USAGE_CMD,
    },
    {
      name: 'gemini',
      // Handled specially in src/index.js by reading ~/.gemini/settings.json
      // to surface the current model (mirrors the `/model` slash command).
      // Setting GEMINI_USAGE_CMD forces the exec path instead.
      command: env.GEMINI_USAGE_CMD || 'gemini usage',
      builtin: !env.GEMINI_USAGE_CMD,
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
