# check-llm-usage

A Node.js CLI that summarizes LLM usage across providers and prints token counts and an estimated USD cost.

Out-of-the-box support:

| Provider | How usage is collected |
|---|---|
| Claude (Anthropic) | Reads `~/.claude/projects/*/*.jsonl` session logs and reports current **5-hour window cost**, **weekly cost**, and **lifetime cost** — the same numbers Claude Code's `/usage` slash command surfaces |
| Gemini | Reads `~/.gemini/settings.json` and reports the **currently selected model** — the same value Gemini CLI's `/model` slash command surfaces |
| Copilot / OpenAI / Groq / Perplexity | Runs a user-configurable shell command (see [Other providers](#other-providers)) |

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

Example output (with `CLAUDE_PLAN=pro` set):

```
LLM Usage Summary
=================
- claude: ok
  current_model: claude-opus-4-7

  Current session (5h window)
    Resets in 2 hr 45 min
    88% used ($32.37 of ~$35.00)

  Weekly (rolling 7d)
    Rolling-window end in 20 hr 5 min
    All models:  36% used ($34.34 of ~$95.00)
    Opus only:   50% used ($34.34 of ~$70.00)

  Lifetime cost: $34.34
- gemini: ok
  current_model: gemini-3.1-pro-preview

Not detected on your system: copilot, openai, groq, perplexity
```

Without `CLAUDE_PLAN` or explicit `*_LIMIT_USD` env vars, the `%` lines are omitted and just dollar amounts are shown. Providers that aren't installed, aren't configured, or don't produce usable data are rolled up into the single `Not detected on your system` line. Full JSON (`--json`) still reports each provider's raw status (`ok`, `no_data`, `not_installed`, `failed`) for scripting.

## Claude: built-in reader

Claude Code writes one JSONL per session under `~/.claude/projects/<slug>/<session-id>.jsonl`. This tool aggregates `input_tokens`, `output_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens` from every assistant message, multiplies by per-model prices, and reports three cost buckets:

- **Current session (5h window)** — cost attributed to messages from the last 5 hours, plus how long until the oldest message in the window ages out (matches Claude Code's session reset behavior)
- **Weekly (rolling 7d)** — split into "all models" and "Opus only"
- **Lifetime cost** — every cost entry found on disk

### Plan limits for the "% used" view

Claude Code's `/usage` shows `% used` against your plan's session and weekly limits. Those limits aren't stored on disk, so you need to tell this tool which plan you're on:

| Env var | Effect |
|---|---|
| `CLAUDE_PLAN=pro` | Uses baked-in Pro defaults: session $35, weekly $95, Opus weekly $70 |
| `CLAUDE_SESSION_LIMIT_USD` | Overrides the session limit (in USD) |
| `CLAUDE_WEEKLY_LIMIT_USD` | Overrides the weekly all-models limit |
| `CLAUDE_OPUS_WEEKLY_LIMIT_USD` | Overrides the Opus-only weekly limit |

> The Pro defaults were calibrated against a real Pro user's `/usage` screenshot (88% session / 36% weekly / 50% Opus) and are accurate to roughly ±10%. Pro quotas are measured in "token-equivalent units" internally, which map to public API pricing closely but not exactly (cache discounts, model mix). If your `% used` here drifts from what Claude Code shows, adjust the `*_LIMIT_USD` vars. Max-plan defaults aren't baked in — set the vars manually.

Weekly reset times inside Claude Code are anchored to a specific weekday (e.g. "Sat 1:00 AM"); we can't know that from disk, so this tool reports the weekly bucket as a rolling 7-day window.

To force the exec path instead of the built-in reader, set `CLAUDE_USAGE_CMD`.

## Gemini: built-in reader

Reads `~/.gemini/settings.json` → `model.name` and reports that model id — the same thing `/model` prints inside the Gemini CLI. Token usage isn't persisted on disk, so this tool doesn't attempt to count tokens for Gemini.

To force the exec path instead, set `GEMINI_USAGE_CMD`.

## Other providers

> ⚠️ **Known limitation.** The default commands for `copilot`, `openai`, `groq`, and `perplexity` are placeholders. None of those CLIs expose a real `usage` subcommand today, so they roll up into the `Not detected on your system` line by default. Supply your own command via the env vars below (e.g. a script that hits the provider's billing API) to populate real numbers. Real built-in implementations per provider are tracked as follow-up work.

Override the command used for any provider:

| Env var | Default |
|---|---|
| `CLAUDE_USAGE_CMD` | (built-in JSONL reader) |
| `GEMINI_USAGE_CMD` | (built-in settings reader) |
| `COPILOT_USAGE_CMD` | `gh copilot usage` |
| `OPENAI_USAGE_CMD` | `openai api usage` |
| `GROQ_USAGE_CMD` | `groq usage` |
| `PERPLEXITY_USAGE_CMD` | `pplx usage` |
| `LLM_USAGE_TIMEOUT_MS` | `30000` |

The command's combined stdout+stderr is scanned for patterns like `input tokens: 1,200` and `$0.12`. Anything matching is reported; anything else rolls into the not-detected line.

## Development

```bash
npm install
npm test
npm start
```

Requires Node.js 18+.

## License

MIT
