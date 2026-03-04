import { Command } from "commander";
import { summaryCommand, type SummaryOptions } from "./commands/summary";
import { debugCommand } from "./commands/debug";
import { savingsCommand } from "./commands/savings";

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
  .command("savings")
  .description("Identify where tokens are wasted and how to reduce them")
  .action(async () => {
    await savingsCommand();
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
