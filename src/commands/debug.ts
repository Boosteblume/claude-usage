import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";
import { AssistantEntrySchema } from "../parser/types";

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

export async function debugCommand(): Promise<void> {
  console.log(chalk.cyan(`\nScanning: ${CLAUDE_PROJECTS_DIR}\n`));

  let dirEntries: Dirent[];
  try {
    dirEntries = await fs.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(chalk.red(`✗ Cannot read projects dir: ${String(e)}`));
    return;
  }

  const dirs = dirEntries.filter((d) => d.isDirectory());
  console.log(
    `Found ${chalk.yellow(String(dirs.length))} project directories\n`,
  );

  // Inspect first 3 projects only — enough to diagnose
  for (const dir of dirs.slice(0, 3)) {
    console.log(chalk.bold(`📁 ${dir.name}`));

    const dirPath = path.join(CLAUDE_PROJECTS_DIR, dir.name);
    let files: Dirent[];
    try {
      files = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      console.log(chalk.red("  ✗ Cannot read directory\n"));
      continue;
    }

    const jsonlFiles = files.filter(
      (f) => f.isFile() && f.name.endsWith(".jsonl"),
    );
    console.log(
      `  ${chalk.yellow(String(jsonlFiles.length))} .jsonl files found`,
    );

    const firstFile = jsonlFiles.at(0);
    if (firstFile === undefined) {
      console.log(chalk.dim("  No .jsonl files — skipping\n"));
      continue;
    }

    const filePath = path.join(dirPath, firstFile.name);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      console.log(chalk.red("  ✗ Cannot read file\n"));
      continue;
    }

    const lines = content.split("\n").filter((l) => l.trim() !== "");
    console.log(
      `  ${chalk.yellow(String(lines.length))} non-empty lines in ${firstFile.name}`,
    );

    // Report the type distribution of the first 30 lines
    const typeCounts: Record<string, number> = {};
    for (const line of lines.slice(0, 30)) {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof raw !== "object" || raw === null) continue;
      const t = String((raw as Record<string, unknown>)["type"] ?? "MISSING");
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    }
    console.log("  Entry types (first 30):", typeCounts);

    // Find the first assistant entry and run Zod against it
    let foundAssistant = false;
    for (const line of lines) {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof raw !== "object" || raw === null) continue;
      const record = raw as Record<string, unknown>;
      if (record["type"] !== "assistant") continue;

      foundAssistant = true;
      console.log(
        chalk.green("\n  First assistant entry found — running Zod parse..."),
      );

      const result = AssistantEntrySchema.safeParse(raw);
      if (result.success) {
        console.log(chalk.green("  ✓ Zod parse successful — schema matches"));
      } else {
        console.log(chalk.red("  ✗ Zod parse FAILED. Issues:"));
        for (const issue of result.error.issues) {
          const fieldPath = issue.path.join(".") || "(root)";
          console.log(chalk.red(`    [${fieldPath}] ${issue.message}`));
        }

        // Print the top-level keys and message keys to help fix the schema
        console.log(
          chalk.dim("\n  Top-level keys:"),
          Object.keys(record).join(", "),
        );
        const msg = record["message"];
        if (typeof msg === "object" && msg !== null) {
          console.log(
            chalk.dim("  message keys:    "),
            Object.keys(msg as object).join(", "),
          );
          const usage = (msg as Record<string, unknown>)["usage"];
          if (typeof usage === "object" && usage !== null) {
            console.log(
              chalk.dim("  usage keys:      "),
              Object.keys(usage as object).join(", "),
            );
          }
        }

        // Print the raw assistant entry so we can see the actual shape
        console.log(chalk.dim("\n  Raw entry (truncated):"));
        console.log(
          chalk.dim(
            JSON.stringify(raw, null, 2).split("\n").slice(0, 40).join("\n"),
          ),
        );
      }
      break;
    }

    if (!foundAssistant) {
      console.log(
        chalk.yellow("  ⚠ No assistant-type entries found in this file"),
      );
    }

    console.log();
  }
}
