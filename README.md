# check-llm-usage

Node.js CLI to check LLM usage for:
- Claude
- Gemini
- GitHub Copilot

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

You can override them with environment variables:
- `CLAUDE_USAGE_CMD`
- `GEMINI_USAGE_CMD`
- `COPILOT_USAGE_CMD`
- `LLM_USAGE_TIMEOUT_MS` (defaults to `30000`)
