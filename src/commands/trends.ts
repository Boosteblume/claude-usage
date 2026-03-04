import os from "node:os";
import chalk from "chalk";
import Table from "cli-table3";
import { loadAllProjects } from "../parser/reader";
import {
  formatTokenCount,
  formatCost,
  formatDate,
  getISOWeekLabel,
  formatSparkline,
  indent,
} from "../lib/format";

export interface TrendsOptions {
  since?: string;
  by: string;
  format: string;
}

interface TrendBucket {
  label: string;
  date: Date;
  totalCostUSD: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalOutputTokens: number;
  sessionCount: number;
  activeProjects: Set<string>;
}

function getBucketKey(date: Date, by: string): string {
  return by === "week" ? getISOWeekLabel(date) : formatDate(date);
}

export async function trendsCommand(options: TrendsOptions): Promise<void> {
  if (!["day", "week"].includes(options.by)) {
    console.error(chalk.red(`Invalid --by "${options.by}". Use: day, week`));
    process.exit(1);
  }
  if (!["table", "json"].includes(options.format)) {
    console.error(
      chalk.red(`Invalid --format "${options.format}". Use: table, json`),
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

  const projects = await loadAllProjects(sinceDate);

  if (projects.length === 0) {
    console.log(chalk.yellow("\n  No usage data found.\n"));
    return;
  }

  // ─── Bucket sessions ──────────────────────────────────────────────────────

  const buckets = new Map<string, TrendBucket>();

  for (const project of projects) {
    for (const session of project.sessions) {
      const key = getBucketKey(session.startedAt, options.by);
      const existing = buckets.get(key);

      if (existing === undefined) {
        buckets.set(key, {
          label: key,
          date: session.startedAt,
          totalCostUSD: session.totalCostUSD,
          totalCacheReadTokens: session.totalCacheReadTokens,
          totalCacheCreationTokens: session.totalCacheCreationTokens,
          totalOutputTokens: session.totalOutputTokens,
          sessionCount: 1,
          activeProjects: new Set([project.projectPath]),
        });
      } else {
        existing.totalCostUSD += session.totalCostUSD;
        existing.totalCacheReadTokens += session.totalCacheReadTokens;
        existing.totalCacheCreationTokens += session.totalCacheCreationTokens;
        existing.totalOutputTokens += session.totalOutputTokens;
        existing.sessionCount++;
        existing.activeProjects.add(project.projectPath);
      }
    }
  }

  const sorted = Array.from(buckets.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  if (sorted.length === 0) {
    console.log(chalk.yellow("\n  No data in the selected time range.\n"));
    return;
  }

  const allLabels = sorted.map((b) => b.label);
  const costs = sorted.map((b) => b.totalCostUSD);
  const sparkWidth = Math.min(allLabels.length, 30);

  // ─── JSON output ──────────────────────────────────────────────────────────

  if (options.format === "json") {
    console.log(
      JSON.stringify(
        sorted.map((b) => ({
          label: b.label,
          date: b.date.toISOString(),
          totalCostUSD: b.totalCostUSD,
          totalCacheReadTokens: b.totalCacheReadTokens,
          totalCacheCreationTokens: b.totalCacheCreationTokens,
          totalOutputTokens: b.totalOutputTokens,
          sessionCount: b.sessionCount,
          // Set is not JSON-serializable — emit the count
          activeProjects: b.activeProjects.size,
        })),
        null,
        2,
      ),
    );
    return;
  }

  // ─── Table output ─────────────────────────────────────────────────────────

  const maxCost = costs.reduce((a, b) => (b > a ? b : a), 0);
  const minCost = costs.reduce((a, b) => (b < a ? b : a), Infinity);

  console.log();
  console.log(chalk.bold.cyan(`  USAGE TRENDS  (by ${options.by})`));
  if (sinceDate !== undefined) {
    console.log(chalk.dim(`  From ${formatDate(sinceDate)} onwards`));
  }
  console.log(chalk.dim("  Sessions bucketed by start date"));
  console.log(chalk.dim("  " + "─".repeat(60)));
  console.log();

  const table = new Table({
    head: [
      chalk.cyan(options.by === "week" ? "Week" : "Date"),
      chalk.cyan("Cost"),
      chalk.cyan("Cache Rd"),
      chalk.cyan("Cache Wt"),
      chalk.cyan("Output"),
      chalk.cyan("Sessions"),
      chalk.cyan("Projects"),
    ],
    style: { border: ["dim"], head: [] },
    colAligns: ["left", "right", "right", "right", "right", "right", "right"],
  });

  for (const bucket of sorted) {
    const costColor =
      bucket.totalCostUSD >= maxCost * 0.8
        ? chalk.red
        : bucket.totalCostUSD >= maxCost * 0.5
          ? chalk.yellow
          : chalk.reset;

    table.push([
      bucket.label,
      costColor(formatCost(bucket.totalCostUSD)),
      formatTokenCount(bucket.totalCacheReadTokens),
      formatTokenCount(bucket.totalCacheCreationTokens),
      formatTokenCount(bucket.totalOutputTokens),
      String(bucket.sessionCount),
      String(bucket.activeProjects.size),
    ]);
  }

  console.log(indent(table.toString()));
  console.log();

  // ─── Overall cost sparkline ───────────────────────────────────────────────

  const costSparkline = formatSparkline(costs, sparkWidth);
  const costRange =
    isFinite(minCost) && minCost !== maxCost
      ? `${formatCost(minCost)} → ${formatCost(maxCost)}`
      : formatCost(maxCost);

  console.log(`  Cost trend    ${chalk.cyan(costSparkline)}`);
  console.log(chalk.dim(`  Range         ${costRange} per ${options.by}`));
  console.log();

  // ─── Per-project sparklines ───────────────────────────────────────────────

  console.log(chalk.bold("  PER PROJECT"));
  console.log();

  const HOME = os.homedir();
  // Already sorted desc by cost from loadAllProjects
  for (const project of projects.slice(0, 10)) {
    // Map this project's cost into the global time axis
    // — fills 0 for periods where the project had no sessions
    const projectBuckets = new Map<string, number>();
    for (const session of project.sessions) {
      const key = getBucketKey(session.startedAt, options.by);
      projectBuckets.set(
        key,
        (projectBuckets.get(key) ?? 0) + session.totalCostUSD,
      );
    }

    const projectCosts = allLabels.map(
      (label) => projectBuckets.get(label) ?? 0,
    );
    const projectSparkline = formatSparkline(projectCosts, sparkWidth);

    const displayPath = project.projectPath.replace(HOME, "~");
    const truncated =
      displayPath.length > 42 ? `…${displayPath.slice(-41)}` : displayPath;

    console.log(
      `  ${truncated.padEnd(43)}${chalk.cyan(projectSparkline)}  ${chalk.dim(formatCost(project.totalCostUSD))}`,
    );
  }

  console.log();
}
