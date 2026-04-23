# check-llm-usage

Node.js CLI (publishable as `llm-usage-summary`) to check LLM usage for:
- Claude
- Gemini
- GitHub Copilot
- OpenAI
- Groq
- Perplexity

## Usage

```bash
npm install
npm start
```

Output includes a per-provider summary with status, token metrics (when available), and estimated USD cost (when available).

### JSON output

```bash
npm start -- --json
```

### Override commands

By default this tool runs:
- `claude usage`
- `gemini usage`
- `gh copilot usage`
- `openai api usage`
- `groq usage`
- `pplx usage`

You can override them with environment variables:
- `CLAUDE_USAGE_CMD`
- `GEMINI_USAGE_CMD`
- `COPILOT_USAGE_CMD`
- `OPENAI_USAGE_CMD`
- `GROQ_USAGE_CMD`
- `PERPLEXITY_USAGE_CMD`
- `LLM_USAGE_TIMEOUT_MS` (defaults to `30000`)
