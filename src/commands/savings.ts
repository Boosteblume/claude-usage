import os from "node:os";
import chalk from "chalk";
import Table from "cli-table3";
import { loadSavingsData } from "../parser/reader";
import type { ProjectSavingsData, SessionSavingsData } from "../parser/types";
import {
  formatTokenCount,
  formatCost,
  formatPercent,
  formatDate,
  indent,
} from "../lib/format";

// ─── Aggregation ──────────────────────────────────────────────────────────────

interface AggregatedToolStats {
  name: string;
  callCount: number;
  totalResultTokens: number;
  avgResultTokens: number;
  errorCount: number;
  errorRate: number;
  projectCount: number;
}

function aggregateToolStats(
  projects: ProjectSavingsData[],
): AggregatedToolStats[] {
  const statsMap = new Map<
    string,
    {
      callCount: number;
      totalResultTokens: number;
      errorCount: number;
      projects: Set<string>;
    }
  >();

  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        for (const call of turn.toolCalls) {
          const existing = statsMap.get(call.toolName);
          if (existing === undefined) {
            statsMap.set(call.toolName, {
              callCount: 1,
              totalResultTokens: call.resultTokens,
              errorCount: call.isError ? 1 : 0,
              projects: new Set([project.projectPath]),
            });
          } else {
            existing.callCount++;
            existing.totalResultTokens += call.resultTokens;
            if (call.isError) existing.errorCount++;
            existing.projects.add(project.projectPath);
          }
        }
      }
    }
  }

  return Array.from(statsMap.entries())
    .map(([name, stats]) => ({
      name,
      callCount: stats.callCount,
      totalResultTokens: stats.totalResultTokens,
      avgResultTokens:
        stats.callCount > 0
          ? Math.round(stats.totalResultTokens / stats.callCount)
          : 0,
      errorCount: stats.errorCount,
      errorRate: stats.callCount > 0 ? stats.errorCount / stats.callCount : 0,
      projectCount: stats.projects.size,
    }))
    .sort((a, b) => b.totalResultTokens - a.totalResultTokens);
}

function calcThinkingOverhead(projects: ProjectSavingsData[]): {
  totalThinkingTokens: number;
  totalOutputTokens: number;
  ratio: number;
} {
  let totalThinkingTokens = 0;
  let totalOutputTokens = 0;
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        totalThinkingTokens += turn.thinkingTokensEstimate;
        totalOutputTokens += turn.outputTokens;
      }
    }
  }
  return {
    totalThinkingTokens,
    totalOutputTokens,
    ratio: totalOutputTokens > 0 ? totalThinkingTokens / totalOutputTokens : 0,
  };
}

function findRunawaySessions(
  projects: ProjectSavingsData[],
): Array<{ session: SessionSavingsData; projectPath: string }> {
  return projects
    .flatMap((p) =>
      p.sessions
        .filter((s) => s.hasRunawayContext)
        .map((s) => ({ session: s, projectPath: p.projectPath })),
    )
    .sort(
      (a, b) => b.session.contextGrowthFactor - a.session.contextGrowthFactor,
    );
}

// ─── Display helpers ──────────────────────────────────────────────────────────

const HOME = os.homedir();
const shortPath = (p: string): string => p.replace(HOME, "~");

function sectionHeader(icon: string, title: string): void {
  console.log(chalk.bold(`  ${icon}  ${title}`));
}

// ─── Command ──────────────────────────────────────────────────────────────────

export async function savingsCommand(): Promise<void> {
  process.stderr.write(chalk.dim("  Loading session data...\n"));
  const projects = await loadSavingsData();
  process.stderr.write("\x1B[1A\x1B[2K");

  if (projects.length === 0) {
    console.log(chalk.yellow("\n  No usage data found.\n"));
    return;
  }

  const toolStats = aggregateToolStats(projects);
  const thinking = calcThinkingOverhead(projects);
  const runaway = findRunawaySessions(projects);
  const missingIgnore = projects.filter((p) => !p.hasClaudeIgnore);
  const longSessions = projects
    .flatMap((p) =>
      p.sessions.map((s) => ({ session: s, projectPath: p.projectPath })),
    )
    .filter(({ session }) => session.turns.length > 80)
    .sort((a, b) => b.session.turns.length - a.session.turns.length);

  console.log();
  console.log(chalk.bold.cyan("  TOKEN SAVINGS ANALYSIS"));
  console.log(chalk.dim("  " + "─".repeat(52)));
  console.log(chalk.dim("  Result token counts are estimated (chars ÷ 4)\n"));

  // ── Priority Quick Wins ──────────────────────────────────────────────────────

  console.log(chalk.bold("  ⚡ QUICK WINS\n"));

  const quickWins: Array<{ severity: "high" | "medium"; label: string }> = [];

  const worstErrorTool = toolStats.find((t) => t.errorRate > 0.5);
  if (worstErrorTool !== undefined) {
    quickWins.push({
      severity: "high",
      label: `${worstErrorTool.name} failing ${(worstErrorTool.errorRate * 100).toFixed(0)}% of the time — ${worstErrorTool.errorCount} wasted call(s)`,
    });
  }
  if (missingIgnore.length > 0) {
    quickWins.push({
      severity: "high",
      label: `Add .claudeignore to ${missingIgnore.length} project(s) — reduces file indexing noise`,
    });
  }
  if (longSessions.length > 0) {
    const worst = longSessions.at(0);
    if (worst !== undefined) {
      quickWins.push({
        severity: "medium",
        label: `Longest session is ${worst.session.turns.length} turns — use /compact at task boundaries`,
      });
    }
  }
  if (thinking.ratio > 0.4) {
    quickWins.push({
      severity: "medium",
      label: `${(thinking.ratio * 100).toFixed(0)}% of output budget is thinking — disable for mechanical tasks`,
    });
  }

  if (quickWins.length === 0) {
    console.log(chalk.green("  ✓ No major issues detected\n"));
  } else {
    for (const [i, win] of quickWins.entries()) {
      const icon = win.severity === "high" ? chalk.red("●") : chalk.yellow("●");
      console.log(`  ${icon} ${i + 1}. ${win.label}`);
    }
    console.log();
  }

  // ── 1. Tool output sizes ───────────────────────────────────────────────────

  sectionHeader("🔧", "TOOL OUTPUT SIZE");
  console.log();

  if (toolStats.length === 0) {
    console.log(chalk.dim("  No tool calls found\n"));
  } else {
    const toolTable = new Table({
      head: [
        chalk.cyan("Tool"),
        chalk.cyan("Calls"),
        chalk.cyan("Avg Result"),
        chalk.cyan("Total Result"),
        chalk.cyan("Errors"),
      ],
      style: { border: ["dim"], head: [] },
      colAligns: ["left", "right", "right", "right", "right"],
    });

    for (const stat of toolStats.slice(0, 10)) {
      const avgColor =
        stat.avgResultTokens > 10_000
          ? chalk.red
          : stat.avgResultTokens > 2_000
            ? chalk.yellow
            : chalk.reset;

      const errDisplay =
        stat.errorCount === 0
          ? chalk.dim("—")
          : stat.errorRate > 0.5
            ? chalk.red(
                `${stat.errorCount} (${(stat.errorRate * 100).toFixed(0)}%)`,
              )
            : stat.errorRate > 0.2
              ? chalk.yellow(
                  `${stat.errorCount} (${(stat.errorRate * 100).toFixed(0)}%)`,
                )
              : chalk.dim(
                  `${stat.errorCount} (${(stat.errorRate * 100).toFixed(0)}%)`,
                );

      toolTable.push([
        stat.name,
        String(stat.callCount),
        avgColor(formatTokenCount(stat.avgResultTokens)),
        formatTokenCount(stat.totalResultTokens),
        errDisplay,
      ]);
    }

    console.log(indent(toolTable.toString()));
    console.log();

    // Tool-specific tips for the expensive ones
    const expensive = toolStats.filter((t) => t.avgResultTokens > 3_000);
    if (expensive.length > 0) {
      console.log(chalk.yellow("  💡 Tips:"));
      for (const t of expensive.slice(0, 4)) {
        const tip =
          t.name === "bash"
            ? "pipe large output: cmd | head -50  or  cmd | grep pattern"
            : t.name.match(/read|Read|cat/i) !== null
              ? "read specific line ranges instead of full files"
              : t.name.match(/list|LS|ls/i) !== null
                ? "add a .claudeignore to reduce directory listing size"
                : `avg ${formatTokenCount(t.avgResultTokens)} tokens/call — filter or chunk output`;

        console.log(chalk.dim(`     ${t.name}: ${tip}`));
      }
      console.log();
    }
  }

  // ── 2. Runaway context ────────────────────────────────────────────────────

  sectionHeader("📈", "CONTEXT GROWTH");
  console.log();

  if (runaway.length === 0) {
    console.log(chalk.green("  ✓ No runaway sessions detected\n"));
  } else {
    console.log(
      chalk.yellow(
        `  ⚠  ${runaway.length} session(s) with context growing >4x\n`,
      ),
    );
    for (const { session, projectPath } of runaway.slice(0, 5)) {
      const peak = session.peakContextTokens;
      console.log(
        chalk.dim(
          `       ${session.turns.length} turns · grew ${session.contextGrowthFactor.toFixed(1)}x · peak ${formatTokenCount(peak)} context tokens`,
        ),
      );
      console.log(
        chalk.dim(`       → /clear or /compact at feature/task boundaries`),
      );
      console.log();
    }
  }

  // ── 3. .claudeignore ──────────────────────────────────────────────────────

  sectionHeader("📁", "CLAUDEIGNORE");
  console.log();

  if (missingIgnore.length === 0) {
    console.log(chalk.green("  ✓ All projects have .claudeignore\n"));
  } else {
    for (const project of missingIgnore) {
      console.log(
        chalk.yellow(
          `  ⚠  Missing .claudeignore → ${shortPath(project.projectPath)}`,
        ),
      );
      console.log(
        chalk.dim(
          `       Claude may be indexing node_modules/, dist/, .git/, build/ etc.`,
        ),
      );
      console.log(
        chalk.dim(`       → Copy your .gitignore entries as a starting point`),
      );
      console.log();
    }
  }

  // ── 4. Thinking overhead ──────────────────────────────────────────────────

  sectionHeader("🧠", "EXTENDED THINKING");
  console.log();

  if (thinking.totalThinkingTokens === 0) {
    console.log(chalk.dim("  No thinking blocks detected\n"));
  } else {
    const pct = (thinking.ratio * 100).toFixed(1);
    const label =
      thinking.ratio > 0.4
        ? chalk.yellow(
            `  ⚠  ~${pct}% of output token budget consumed by thinking`,
          )
        : chalk.dim(`  ~${pct}% of output token budget consumed by thinking`);
    console.log(label);
    console.log(
      chalk.dim(
        `  Estimated thinking tokens: ${formatTokenCount(thinking.totalThinkingTokens)}`,
      ),
    );
    if (thinking.ratio > 0.4) {
      console.log(
        chalk.dim(
          `  → Disable extended thinking for mechanical tasks (file edits, refactors, Q&A)`,
        ),
      );
    }
    console.log();
  }

  // ── 5. Long sessions ──────────────────────────────────────────────────────

  sectionHeader("⏱ ", "LONG SESSIONS  (>80 turns)");
  console.log();

  if (longSessions.length === 0) {
    console.log(chalk.green("  ✓ No sessions exceeded 80 turns\n"));
  } else {
    for (const { session, projectPath } of longSessions.slice(0, 3)) {
      console.log(
        `  ${chalk.yellow("⚠")}  ${shortPath(projectPath)} / ${chalk.dim(session.sessionId.slice(0, 8) + "…")} — ${chalk.yellow(String(session.turns.length))} turns`,
      );
      console.log(
        chalk.dim(
          `       → Use CLAUDE.md to persist key context, start fresh sessions per task`,
        ),
      );
      console.log();
    }
  }
}
