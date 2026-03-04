import os from "node:os";
import chalk from "chalk";
import Table from "cli-table3";
import { loadAllProjects, loadSessionDetail } from "../parser/reader";
import type {
  ProjectStats,
  SessionStats,
  TurnDetail,
  SessionDetail,
} from "../parser/types";
import {
  formatTokenCount,
  formatCost,
  formatDate,
  indent,
  formatSparkline,
} from "../lib/format";

export interface SessionsOptions {
  project?: string;
  sort: string;
  id?: string;
}

const HOME = os.homedir();
const shortPath = (p: string): string => p.replace(HOME, "~");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sortedSessions(
  sessions: SessionStats[],
  sort: string,
): SessionStats[] {
  return [...sessions].sort((a, b) => {
    if (sort === "turns") return b.turnCount - a.turnCount;
    if (sort === "date")
      return b.lastActiveAt.getTime() - a.lastActiveAt.getTime();
    return b.totalCostUSD - a.totalCostUSD; // default: cost
  });
}

function growthColor(factor: number): string {
  const str = `${factor.toFixed(1)}×`;
  if (factor >= 10) return chalk.red(str);
  if (factor >= 3) return chalk.yellow(str);
  return chalk.dim(str);
}

// ─── List view ────────────────────────────────────────────────────────────────

function renderSessionsList(projects: ProjectStats[], sort: string): void {
  console.log();
  console.log(chalk.bold.cyan("  SESSIONS"));
  console.log(
    chalk.dim(`  Sorted by: ${sort}  ·  --id <prefix> to drill into a session`),
  );
  console.log(chalk.dim("  " + "─".repeat(60)));
  console.log();

  for (const project of projects) {
    console.log(
      `  ${chalk.bold(shortPath(project.projectPath))}`,
      chalk.dim(
        `${project.sessionCount} session${project.sessionCount !== 1 ? "s" : ""} · ${formatCost(project.totalCostUSD)}`,
      ),
    );
    console.log();

    const table = new Table({
      head: [
        chalk.cyan("Session"),
        chalk.cyan("Turns"),
        chalk.cyan("Peak Ctx"),
        chalk.cyan("Output"),
        chalk.cyan("Cost"),
        chalk.cyan("Growth"),
        chalk.cyan("⚠"),
        chalk.cyan("Date"),
      ],
      style: { border: ["dim"], head: [] },
      colAligns: [
        "left",
        "right",
        "right",
        "right",
        "right",
        "right",
        "center",
        "left",
      ],
    });

    for (const session of sortedSessions(project.sessions, sort)) {
      table.push([
        chalk.dim(session.sessionId.slice(0, 8) + "…"),
        String(session.turnCount),
        formatTokenCount(session.peakContextTokens),
        formatTokenCount(session.totalOutputTokens),
        formatCost(session.totalCostUSD),
        growthColor(session.contextGrowthFactor),
        session.hasRunawayContext ? chalk.red("⚠") : chalk.dim("✓"),
        formatDate(session.startedAt),
      ]);
    }

    console.log(indent(table.toString()));
    console.log();
  }
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function renderSessionDetail(detail: SessionDetail): void {
  const { turns } = detail;

  // Explicit loop — avoids fragile generic inference on .reduce
  let peakTurn: TurnDetail | undefined;
  for (const t of turns) {
    if (
      peakTurn === undefined ||
      t.totalContextTokens > peakTurn.totalContextTokens
    ) {
      peakTurn = t;
    }
  }

  console.log();
  console.log(chalk.bold.cyan("  SESSION DETAIL"));
  console.log(chalk.dim(`  ${detail.sessionId}`));
  console.log(chalk.dim(`  ${shortPath(detail.projectPath)}`));
  console.log(chalk.dim("  " + "─".repeat(60)));
  console.log();
  console.log(`  Turns          ${chalk.yellow(String(turns.length))}`);
  console.log(
    `  Total Cost     ${chalk.yellow(formatCost(detail.totalCostUSD))}`,
  );
  console.log(`  Context Growth ${growthColor(detail.contextGrowthFactor)}`);
  console.log(
    `  Peak Context   ${formatTokenCount(detail.peakContextTokens)}` +
      (peakTurn !== undefined
        ? chalk.dim(` at turn ${peakTurn.turnIndex + 1}`)
        : ""),
  );

  if (detail.hasRunawayContext) {
    console.log(
      chalk.red(
        `\n  ⚠ Runaway context — use /clear or /compact at task boundaries`,
      ),
    );
  }

  const contextValues = turns.map((t) => t.totalContextTokens);
  const ctxSparkWidth = Math.min(contextValues.length, 40);
  const ctxSparkline = formatSparkline(contextValues, ctxSparkWidth);
  const ctxMin = contextValues.reduce((a, b) => (b < a ? b : a), Infinity);
  const ctxMax = contextValues.reduce((a, b) => (b > a ? b : a), 0);
  const ctxMinFormatted = formatTokenCount(isFinite(ctxMin) ? ctxMin : 0);
  const ctxMaxFormatted = formatTokenCount(ctxMax);

  console.log(
    `  Context arc   ${chalk.cyan(ctxSparkline)}` +
      chalk.dim(`  ${ctxMinFormatted} → ${ctxMaxFormatted}`),
  );
  console.log();

  if (turns.length > 50) {
    console.log(
      chalk.dim(
        `\n  ${turns.length} turns — pipe to \`less\` for easier navigation`,
      ),
    );
  }

  console.log();
  console.log(chalk.bold("  TURN-BY-TURN"));
  console.log();

  const table = new Table({
    head: [
      chalk.cyan("#"),
      chalk.cyan("Context"),
      chalk.cyan("Δ"),
      chalk.cyan("Output"),
      chalk.cyan("Cost"),
      chalk.cyan("Tools"),
    ],
    style: { border: ["dim"], head: [] },
    colAligns: ["right", "right", "right", "right", "right", "left"],
  });

  for (const turn of turns) {
    const delta = turn.contextDelta;
    const deltaStr =
      delta === 0
        ? chalk.dim("—")
        : delta < 0
          ? chalk.green(`−${formatTokenCount(Math.abs(delta))}`) // shrink = good
          : delta > 50_000
            ? chalk.yellow(`+${formatTokenCount(delta)}`) // big jump = notable
            : chalk.dim(`+${formatTokenCount(delta)}`);

    const toolStr =
      turn.toolNames.length === 0
        ? chalk.dim("—")
        : turn.toolNames.slice(0, 3).join(", ") +
          (turn.toolNames.length > 3
            ? chalk.dim(` +${turn.toolNames.length - 3}`)
            : "");

    table.push([
      String(turn.turnIndex + 1),
      formatTokenCount(turn.totalContextTokens),
      deltaStr,
      formatTokenCount(turn.outputTokens),
      `$${turn.costUSD.toFixed(4)}`,
      toolStr,
    ]);
  }

  console.log(indent(table.toString()));
  console.log();
}

// ─── Command ──────────────────────────────────────────────────────────────────

export async function sessionsCommand(options: SessionsOptions): Promise<void> {
  const validSorts = ["cost", "turns", "date"];
  if (!validSorts.includes(options.sort)) {
    console.error(
      chalk.red(`Invalid --sort "${options.sort}". Use: cost, turns, date`),
    );
    process.exit(1);
  }

  const projects = await loadAllProjects();

  if (projects.length === 0) {
    console.log(chalk.yellow("\n  No usage data found.\n"));
    return;
  }

  // ── Detail drilldown ──────────────────────────────────────────────────────

  if (options.id !== undefined) {
    const searchId = options.id;
    let matchFilePath: string | undefined;

    for (const project of projects) {
      const match = project.sessions.find(
        (s) => s.sessionId === searchId || s.sessionId.startsWith(searchId),
      );
      if (match !== undefined) {
        matchFilePath = match.filePath;
        break;
      }
    }

    if (matchFilePath === undefined) {
      console.error(chalk.red(`\n  Session "${searchId}" not found.\n`));
      process.exit(1);
    }

    const detail = await loadSessionDetail(matchFilePath);
    if (detail === null) {
      console.error(chalk.red(`\n  Could not parse session "${searchId}".\n`));
      process.exit(1);
    }

    renderSessionDetail(detail);
    return;
  }

  // ── Sessions list ─────────────────────────────────────────────────────────

  const filtered =
    options.project !== undefined
      ? projects.filter(
          (p) =>
            p.projectPath.includes(options.project!) ||
            p.projectDirName.includes(options.project!),
        )
      : projects;

  if (filtered.length === 0) {
    console.log(
      chalk.yellow(`\n  No projects matching "${options.project ?? ""}".\n`),
    );
    return;
  }

  renderSessionsList(filtered, options.sort);
}
