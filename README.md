# claude-usage

Analyse your Claude Code token usage, track spending over time, and find opportunities to reduce costs. Reads session data directly from `~/.claude/projects/` — no API key required.

## Installation

```bash
npm install -g claude-usage-analyser
```

Or run without installing:

```bash
npx claude-usage-analyser <command>
```

## Commands

- [`summary`](#summary) — cost and token overview across all projects
- [`sessions`](#sessions) — per-session breakdown with context growth metrics
- [`trends`](#trends) — daily or weekly token burn rate with sparklines
- [`savings`](#savings) — identify where tokens are wasted
- [`debug`](#debug) — diagnose JSONL parsing issues

---

### `summary`

High-level overview of costs and token usage across all your Claude Code projects.

```bash
claude-usage summary
```

Shows:

- Total cost (USD), project count, session count, turn count, and date range
- Token breakdown — fresh input, cache reads, cache writes, and output tokens, each as a percentage of total context
- Cache efficiency — percentage of context served from cache (highlighted green if ≥50%)
- Top 10 projects by cost with per-project session count, turn count, input, and output tokens

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--since <date>` | Only include sessions from this date onwards (`YYYY-MM-DD`) | All time |
| `--format <format>` | `table` or `json` | `table` |

```bash
claude-usage summary --since 2026-03-01
claude-usage summary --format json
```

---

### `sessions`

Lists all sessions per project with context growth metrics. Drill into any session for a turn-by-turn breakdown.

```bash
claude-usage sessions
```

The list view shows each session's turn count, peak context size, output tokens, cost, context growth factor, runaway flag, and start date.

Use `--id` to drill into a specific session and see a turn-by-turn table with context size, context delta, output tokens, cost per turn, and tool calls used. A sparkline of the context arc is shown at the top.

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--project <path>` | Filter to projects whose path contains this string | All projects |
| `--sort <key>` | Sort sessions by `cost`, `turns`, or `date` | `cost` |
| `--id <prefix>` | Show turn-by-turn detail for a session (8-char prefix is enough) | — |

```bash
# Filter to a specific project
claude-usage sessions --project my-app

# Sort by most turns
claude-usage sessions --sort turns

# Drill into a specific session
claude-usage sessions --id a1b2c3d4
```

---

### `trends`

Shows daily or weekly token burn rate, with a cost sparkline and per-project sparklines for the top 10 projects.

```bash
claude-usage trends
```

The table shows cost, cache read tokens, cache write tokens, output tokens, session count, and active project count for each time bucket. High-cost periods are colour-coded red/yellow. A global cost sparkline and per-project sparklines are printed below the table.

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--since <date>` | Only include data from this date onwards (`YYYY-MM-DD`) | All time |
| `--by <granularity>` | Bucket by `day` or `week` | `day` |
| `--format <format>` | `table` or `json` | `table` |

```bash
claude-usage trends --by week
claude-usage trends --since 2026-01-01 --by week
claude-usage trends --format json
```

---

### `savings`

Identifies where tokens are wasted and gives actionable recommendations to reduce costs.

```bash
claude-usage savings
```

Starts with a **Quick Wins** section that surfaces the highest-priority issues. Then analyses:

- **Tool output size** — top 10 tools by total result tokens, with average tokens per call and error rates. Tools producing large outputs are highlighted and tool-specific tips are shown (e.g. piping bash output, reading specific line ranges)
- **Context growth** — sessions where context grew more than 4× from first to last turn, with the growth factor and peak input token count. Recommends using `/clear` or `/compact` at task boundaries
- **`.claudeignore` coverage** — lists projects missing a `.claudeignore`, which may cause Claude to index `node_modules/`, `dist/`, `.git/`, etc.
- **Extended thinking overhead** — estimates how much of your output token budget is consumed by thinking blocks. Flags it if >40% and recommends disabling for mechanical tasks
- **Long sessions** — sessions exceeding 80 turns, with advice to use `/compact` or start a fresh session per task

> Note: tool result token counts are estimated (characters ÷ 4) as Claude Code does not record them directly.

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--format <format>` | `table` or `json` | `table` |

---

### `debug`

Diagnoses JSONL parsing issues by inspecting the raw session files in `~/.claude/projects/`.

```bash
claude-usage debug
```

Run this if `summary`, `sessions`, or `trends` shows no data. For the first 3 project directories it:

- Reports the number of `.jsonl` session files found
- Prints the distribution of entry types in the first 30 lines
- Finds the first `assistant`-type entry, runs it through the Zod schema, and prints any validation errors alongside the raw entry shape

Useful for diagnosing schema mismatches if Claude Code changes its session file format.

---

## Requirements

- Node.js ≥ 18
- Claude Code must have been used at least once — session data is read from `~/.claude/projects/`
