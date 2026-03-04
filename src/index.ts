import { Command } from "commander";
import { summaryCommand, type SummaryOptions } from "./commands/summary";
import { sessionsCommand, type SessionsOptions } from "./commands/sessions";
import { savingsCommand, type SavingsOptions } from "./commands/savings";
import { trendsCommand, type TrendsOptions } from "./commands/trends";
import { debugCommand } from "./commands/debug";

const program = new Command();

program
  .name("claude-usage")
  .description(
    "Analyse your Claude Code token usage and find savings opportunities",
  )
  .version("0.1.0");

program
  .command("summary")
  .description("High-level token and cost overview across all projects")
  .option(
    "--since <date>",
    "Filter sessions active from this date onwards (YYYY-MM-DD)",
  )
  .option("--format <format>", "Output format: table or json", "table")
  .action(async (options: SummaryOptions) => {
    await summaryCommand(options);
  });

program
  .command("sessions")
  .description("List all sessions per project with context growth metrics")
  .option(
    "--project <path>",
    "Filter to projects whose path includes this string",
  )
  .option("--sort <key>", "Sort by: cost, turns, date", "cost")
  .option(
    "--id <prefix>",
    "Turn-by-turn detail for a specific session (8-char prefix ok)",
  )
  .action(async (options: SessionsOptions) => {
    await sessionsCommand(options);
  });

program
  .command("trends")
  .description("Daily or weekly token burn rate with per-project sparklines")
  .option("--since <date>", "Filter from this date onwards (YYYY-MM-DD)")
  .option("--by <granularity>", "Bucket by: day, week", "day")
  .option("--format <format>", "Output format: table or json", "table")
  .action(async (options: TrendsOptions) => {
    await trendsCommand(options);
  });

program
  .command("savings")
  .description("Identify where tokens are wasted and how to reduce them")
  .option("--format <format>", "Output format: table or json", "table")
  .action(async (options: SavingsOptions) => {
    await savingsCommand(options);
  });

program
  .command("debug")
  .description(
    "Diagnose JSONL parsing — prints schema match results for raw entries",
  )
  .action(async () => {
    await debugCommand();
  });

await program.parseAsync();
