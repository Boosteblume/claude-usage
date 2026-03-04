import os from "node:os";
import chalk from "chalk";
import Table from "cli-table3";
import { loadAllProjects } from "../parser/reader";
import {
  formatTokenCount,
  formatCost,
  formatPercent,
  formatDate,
  formatDateRange,
  indent,
} from "../lib/format";

export interface SummaryOptions {
  since?: string;
  format: string;
}

export async function summaryCommand(options: SummaryOptions): Promise<void> {
  // ─── Option validation ────────────────────────────────────────────────────

  if (options.format !== "table" && options.format !== "json") {
    console.error(
      chalk.red(`Invalid --format "${options.format}". Use "table" or "json".`),
    );
    process.exit(1);
  }

  let sinceDate: Date | undefined;
  if (options.since !== undefined) {
    sinceDate = new Date(options.since);
    if (isNaN(sinceDate.getTime())) {
      console.error(
        chalk.red(`Invalid --since date "${options.since}". Use YYYY-MM-DD.`),
      );
      process.exit(1);
    }
  }

  // ─── Data loading ──────────────────────────────────────────────────────────

  const projects = await loadAllProjects(sinceDate);

  if (projects.length === 0) {
    console.log(chalk.yellow("\n  No usage data found."));
    console.log(
      chalk.dim(
        "  Ensure Claude Code has been used and ~/.claude/projects/ exists.\n",
      ),
    );
    return;
  }

  // ─── Aggregation ──────────────────────────────────────────────────────────

  const totalCostUSD = projects.reduce((sum, p) => sum + p.totalCostUSD, 0);
  const totalInputTokens = projects.reduce(
    (sum, p) => sum + p.totalInputTokens,
    0,
  );
  const totalOutputTokens = projects.reduce(
    (sum, p) => sum + p.totalOutputTokens,
    0,
  );
  const totalCacheReadTokens = projects.reduce(
    (sum, p) => sum + p.totalCacheReadTokens,
    0,
  );
  const totalCacheCreationTokens = projects.reduce(
    (sum, p) => sum + p.totalCacheCreationTokens,
    0,
  );
  const totalSessions = projects.reduce((sum, p) => sum + p.sessionCount, 0);
  const totalTurns = projects.reduce((sum, p) => sum + p.turnCount, 0);

  const allDates = projects
    .flatMap((p) => p.sessions)
    .flatMap((s) => [s.startedAt, s.lastActiveAt]);

  // total tokens that count as "input context" (excl. output)
  const totalContextTokens =
    totalInputTokens + totalCacheReadTokens + totalCacheCreationTokens;
  // || 1 prevents division by zero on empty/no-cache datasets
  const cacheHitRatio = totalCacheReadTokens / (totalContextTokens || 1);

  // ─── JSON output ──────────────────────────────────────────────────────────

  if (options.format === "json") {
    console.log(
      JSON.stringify(
        {
          totalCostUSD,
          totalInputTokens,
          totalOutputTokens,
          totalCacheReadTokens,
          totalCacheCreationTokens,
          totalSessions,
          totalTurns,
          projects: projects.map((p) => ({
            projectPath: p.projectPath,
            totalCostUSD: p.totalCostUSD,
            sessionCount: p.sessionCount,
            turnCount: p.turnCount,
            totalInputTokens: p.totalInputTokens,
            totalOutputTokens: p.totalOutputTokens,
            totalCacheReadTokens: p.totalCacheReadTokens,
            totalCacheCreationTokens: p.totalCacheCreationTokens,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  // ─── Table output ─────────────────────────────────────────────────────────

  console.log();
  console.log(chalk.bold.cyan("  CLAUDE CODE USAGE SUMMARY"));
  if (sinceDate !== undefined) {
    console.log(chalk.dim(`  Filtered from ${formatDate(sinceDate)} onwards`));
  }
  console.log(chalk.dim("  " + "─".repeat(52)));
  console.log();

  // Overview
  console.log(chalk.bold("  OVERVIEW"));
  console.log();
  console.log(`  Total Cost      ${chalk.yellow(formatCost(totalCostUSD))}`);
  console.log(`  Projects        ${projects.length}`);
  console.log(`  Sessions        ${totalSessions}`);
  console.log(`  Turns           ${totalTurns}`);
  console.log(`  Date Range      ${chalk.dim(formatDateRange(allDates))}`);
  console.log();

  // Token breakdown table
  console.log(chalk.bold("  TOKEN BREAKDOWN"));
  console.log();

  const tokenTable = new Table({
    head: [
      chalk.cyan("Token Type"),
      chalk.cyan("Count"),
      chalk.cyan("% of Context"),
    ],
    style: { border: ["dim"], head: [] },
    colAligns: ["left", "right", "right"],
  });

  tokenTable.push([
    "Input (fresh)",
    formatTokenCount(totalInputTokens),
    formatPercent(totalInputTokens, totalContextTokens),
  ]);
  tokenTable.push([
    "Cache Read",
    formatTokenCount(totalCacheReadTokens),
    formatPercent(totalCacheReadTokens, totalContextTokens),
  ]);
  tokenTable.push([
    "Cache Creation",
    formatTokenCount(totalCacheCreationTokens),
    formatPercent(totalCacheCreationTokens, totalContextTokens),
  ]);
  tokenTable.push([
    chalk.dim("Output"),
    chalk.dim(formatTokenCount(totalOutputTokens)),
    chalk.dim("—"),
  ]);

  console.log(indent(tokenTable.toString()));
  console.log();

  const cacheLabel =
    cacheHitRatio >= 0.5
      ? chalk.green(
          `${(cacheHitRatio * 100).toFixed(1)}% of context served from cache ✓`,
        )
      : chalk.yellow(
          `${(cacheHitRatio * 100).toFixed(1)}% of context served from cache`,
        );

  console.log(`  Cache Efficiency  ${cacheLabel}`);
  console.log();

  // Top projects table (already sorted desc by cost from loadAllProjects)
  console.log(chalk.bold("  TOP PROJECTS BY COST"));
  console.log();

  const projectTable = new Table({
    head: [
      chalk.cyan("Project"),
      chalk.cyan("Cost"),
      chalk.cyan("Sessions"),
      chalk.cyan("Turns"),
      chalk.cyan("Input"),
      chalk.cyan("Output"),
    ],
    style: { border: ["dim"], head: [] },
    colAligns: ["left", "right", "right", "right", "right", "right"],
  });

  const homeDir = os.homedir();

  for (const project of projects.slice(0, 10)) {
    const shortPath = project.projectPath.replace(homeDir, "~");
    const displayPath =
      shortPath.length > 38 ? `…${shortPath.slice(-37)}` : shortPath;

    projectTable.push([
      displayPath,
      chalk.yellow(formatCost(project.totalCostUSD)),
      String(project.sessionCount),
      String(project.turnCount),
      formatTokenCount(project.totalInputTokens),
      formatTokenCount(project.totalOutputTokens),
    ]);
  }

  console.log(indent(projectTable.toString()));
  console.log();
}
