# claude-usage

Analyse your Claude Code token usage and find savings opportunities. Reads session data from `~/.claude/projects/` and gives you a breakdown of costs, token consumption, and where you're wasting tokens.

## Installation

```bash
npm install -g claude-usage-analyser
```

Or run without installing:

```bash
npx claude-usage-analyser <command>
```

## Commands

### `summary`

High-level overview of token usage and costs across all your Claude Code projects.

```bash
claude-usage summary
```

Output includes:

- **Total cost** (USD) across all projects and sessions
- **Token breakdown** — fresh input, cache reads, cache writes, and output tokens
- **Cache efficiency** — percentage of context served from cache (green if ≥50%)
- **Top 10 projects by cost** — with per-project session count, turn count, and token counts

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--since <date>` | Only include sessions active from this date onwards. Format: `YYYY-MM-DD` | All time |
| `--format <format>` | Output format: `table` or `json` | `table` |

**Examples:**

```bash
# Show all-time summary
claude-usage summary

# Show only usage since the start of March
claude-usage summary --since 2026-03-01

# Output as JSON for scripting
claude-usage summary --format json
```

---

### `savings`

Identifies where tokens are being wasted and gives you actionable tips to reduce costs.

```bash
claude-usage savings
```

Analyses your sessions and reports on:

- **Quick wins** — high-priority issues flagged at the top (e.g. tools with high error rates, missing `.claudeignore` files)
- **Tool output size** — top 10 tools by total result tokens, with average tokens per call and error rates. Highlights tools producing large outputs and suggests how to trim them
- **Context growth** — sessions where context grew more than 4× from first to last turn, indicating runaway conversations that should have been compacted
- **`.claudeignore` coverage** — lists projects missing a `.claudeignore`, which may cause Claude to index `node_modules/`, `dist/`, etc.
- **Extended thinking overhead** — estimates how much of your output token budget is consumed by thinking blocks, and flags it if >40%
- **Long sessions** — sessions exceeding 80 turns, with advice to use `/compact` or start fresh sessions per task

> Note: result token counts are estimated (characters ÷ 4) since Claude Code does not record tool result token counts directly.

---

### `debug`

Diagnoses JSONL parsing issues by inspecting raw session files in `~/.claude/projects/`.

```bash
claude-usage debug
```

Useful if `summary` or `savings` shows no data. For each of the first 3 project directories it:

- Lists the number of `.jsonl` session files found
- Reports the distribution of entry types in the first 30 lines
- Finds the first `assistant`-type entry and runs it through the Zod schema, printing any validation errors along with the raw entry shape

Use this to diagnose schema mismatches if Claude Code changes its session file format.

## Requirements

- Node.js ≥ 18
- Claude Code must have been used at least once (session data lives in `~/.claude/projects/`)
