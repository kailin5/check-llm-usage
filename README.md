# check-llm-usage

A Node.js CLI that summarizes LLM usage across providers and prints token counts and an estimated USD cost.

Out-of-the-box support:

| Provider | How usage is collected |
|---|---|
| Claude (Anthropic) | Reads `~/.claude/projects/*/*.jsonl` session logs directly — no extra CLI needed |
| Gemini / Copilot / OpenAI / Groq / Perplexity | Runs a user-configurable shell command (see [Other providers](#other-providers)) |

## Install

```bash
npm install -g check-llm-usage
```

Or run without installing:

```bash
npx check-llm-usage
```

## Usage

```bash
check-llm-usage            # human-readable summary
check-llm-usage --json     # machine-readable JSON
```

Example output:

```
LLM Usage Summary
=================
- claude: ok
  command: read /Users/you/.claude/projects
  input_tokens: 233
  output_tokens: 45027
  total_tokens: 3049245
  est_cost_usd: $13.3505
- gemini: no_data
  ...
```

Statuses:
- `ok` — parsed at least one metric
- `no_data` — command ran but no tokens/cost were found (usually means the default command isn't a real usage command for that provider)
- `not_installed` — the CLI isn't on `PATH`
- `failed` — command exited with an error

## Claude: built-in reader

Claude Code writes one JSONL per session under `~/.claude/projects/<slug>/<session-id>.jsonl`. This tool aggregates `input_tokens`, `output_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens` from every assistant message across every session and multiplies by per-model prices to estimate cost.

Pricing is approximate — the authoritative number is in the Anthropic console.

To force the exec path instead of the built-in reader, set `CLAUDE_USAGE_CMD`.

## Other providers

> ⚠️ **Known limitation.** The default commands for `gemini`, `copilot`, `openai`, `groq`, and `perplexity` are placeholders. None of those CLIs expose a real `usage` subcommand today, so they will typically report `not_installed` or `no_data` out of the box. Supply your own command via the env vars below (e.g. a script that hits the provider's billing API) to populate real numbers. Real built-in implementations per provider are tracked as follow-up work.

Override the command used for any provider:

| Env var | Default |
|---|---|
| `CLAUDE_USAGE_CMD` | (built-in reader) |
| `GEMINI_USAGE_CMD` | `gemini usage` |
| `COPILOT_USAGE_CMD` | `gh copilot usage` |
| `OPENAI_USAGE_CMD` | `openai api usage` |
| `GROQ_USAGE_CMD` | `groq usage` |
| `PERPLEXITY_USAGE_CMD` | `pplx usage` |
| `LLM_USAGE_TIMEOUT_MS` | `30000` |

The command's combined stdout+stderr is scanned for patterns like `input tokens: 1,200` and `$0.12`. Anything matching is reported; anything else shows as `no_data`.

## Development

```bash
npm install
npm test
npm start
```

Requires Node.js 18+.

## License

MIT
