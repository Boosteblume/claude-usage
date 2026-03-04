import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  AssistantEntrySchema,
  type AssistantEntry,
  type Usage,
  type SessionStats,
  type ProjectStats,
  UserEntrySchema,
  type UserEntry,
  type SessionSavingsData,
  type ProjectSavingsData,
  type TurnSavingsData,
  type ToolCallRecord,
  TurnDetail,
  SessionDetail,
} from "./types";

import {
  extractToolUses,
  extractToolResults,
  extractThinkingBlocks,
  estimateTokens,
  estimateToolResultTokens,
  getToolInputPreview,
} from "./content";

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

// ─── Model Pricing ────────────────────────────────────────────────────────────

interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheWritePerM: number;
  cacheReadPerM: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-5": {
    inputPerM: 15,
    outputPerM: 75,
    cacheWritePerM: 18.75,
    cacheReadPerM: 1.5,
  },
  "claude-sonnet-4-5": {
    inputPerM: 3,
    outputPerM: 15,
    cacheWritePerM: 3.75,
    cacheReadPerM: 0.3,
  },
  "claude-sonnet-4-6": {
    inputPerM: 3,
    outputPerM: 15,
    cacheWritePerM: 3.75,
    cacheReadPerM: 0.3,
  },
  "claude-haiku-4-5": {
    inputPerM: 0.8,
    outputPerM: 4,
    cacheWritePerM: 1.0,
    cacheReadPerM: 0.08,
  },
  "claude-3-5-sonnet": {
    inputPerM: 3,
    outputPerM: 15,
    cacheWritePerM: 3.75,
    cacheReadPerM: 0.3,
  },
  "claude-3-5-haiku": {
    inputPerM: 0.8,
    outputPerM: 4,
    cacheWritePerM: 1.0,
    cacheReadPerM: 0.08,
  },
  "claude-3-opus": {
    inputPerM: 15,
    outputPerM: 75,
    cacheWritePerM: 18.75,
    cacheReadPerM: 1.5,
  },
};

const DEFAULT_PRICING: ModelPricing = {
  inputPerM: 3,
  outputPerM: 15,
  cacheWritePerM: 3.75,
  cacheReadPerM: 0.3,
};

function getPricing(model: string): ModelPricing {
  if (MODEL_PRICING[model] !== undefined) return MODEL_PRICING[model];
  const prefixMatch = Object.keys(MODEL_PRICING).find((key) =>
    model.startsWith(key),
  );
  return prefixMatch !== undefined
    ? (MODEL_PRICING[prefixMatch] as ModelPricing)
    : DEFAULT_PRICING;
}

function calculateCost(usage: Usage, model: string): number {
  const p = getPricing(model);
  return (
    (usage.input_tokens * p.inputPerM) / 1_000_000 +
    (usage.output_tokens * p.outputPerM) / 1_000_000 +
    (usage.cache_creation_input_tokens * p.cacheWritePerM) / 1_000_000 +
    (usage.cache_read_input_tokens * p.cacheReadPerM) / 1_000_000
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readJSONLFile(filePath: string): Promise<AssistantEntry[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  const entries: AssistantEntry[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    if (record["type"] !== "assistant") continue;

    const result = AssistantEntrySchema.safeParse(raw);
    if (result.success) entries.push(result.data);
  }

  return entries;
}

function buildSessionStats(
  entries: AssistantEntry[],
  fallbackProjectPath: string,
  filePath: string,
): SessionStats | null {
  const firstEntry = entries.at(0);
  if (firstEntry === undefined) return null;

  const projectPath = firstEntry.cwd ?? fallbackProjectPath;

  let startedAt = new Date(firstEntry.timestamp);
  let lastActiveAt = startedAt;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCostUSD = 0;

  // undefined = not yet seen first turn; avoids the -1 sentinel smell
  let firstTurnContextTokens: number | undefined;
  let lastTurnContextTokens = 0;
  let peakContextTokens = 0;

  for (const entry of entries) {
    const { usage, model } = entry.message;
    totalInputTokens += usage.input_tokens;
    totalOutputTokens += usage.output_tokens;
    totalCacheReadTokens += usage.cache_read_input_tokens;
    totalCacheCreationTokens += usage.cache_creation_input_tokens;
    totalCostUSD += calculateCost(usage, model);

    const ts = new Date(entry.timestamp);
    if (ts < startedAt) startedAt = ts;
    if (ts > lastActiveAt) lastActiveAt = ts;

    // Total context this turn = everything sent to the model
    const turnCtx =
      usage.input_tokens +
      usage.cache_read_input_tokens +
      usage.cache_creation_input_tokens;

    firstTurnContextTokens ??= turnCtx; // set once on first iteration
    lastTurnContextTokens = turnCtx;
    if (turnCtx > peakContextTokens) peakContextTokens = turnCtx;
  }

  const contextGrowthFactor =
    firstTurnContextTokens !== undefined && firstTurnContextTokens > 0
      ? lastTurnContextTokens / firstTurnContextTokens
      : 1;

  return {
    sessionId: firstEntry.sessionId,
    projectPath,
    filePath,
    turnCount: entries.length,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    totalCostUSD,
    startedAt,
    lastActiveAt,
    contextGrowthFactor,
    peakContextTokens,
    hasRunawayContext:
      (contextGrowthFactor > 4 && entries.length > 15) ||
      peakContextTokens > 200_000,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function loadAllProjects(since?: Date): Promise<ProjectStats[]> {
  let dirEntries: Dirent[];
  try {
    dirEntries = await fs.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects: ProjectStats[] = [];

  for (const dirEntry of dirEntries) {
    if (!dirEntry.isDirectory()) continue;

    const dirName = dirEntry.name;
    const dirPath = path.join(CLAUDE_PROJECTS_DIR, dirName);

    // dirName is kept as fallback only — cwd from entries takes precedence
    const fallbackProjectPath = dirName;

    let fileEntries: Dirent[];
    try {
      fileEntries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    const sessions: SessionStats[] = [];

    for (const fileEntry of fileEntries) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith(".jsonl")) continue;

      const filePath = path.join(dirPath, fileEntry.name);
      const entries = await readJSONLFile(filePath);
      const stats = buildSessionStats(entries, fallbackProjectPath, filePath);

      if (stats === null) continue;
      if (since !== undefined && stats.lastActiveAt < since) continue;

      sessions.push(stats);
    }

    if (sessions.length === 0) continue;

    // Derive the canonical project path from the first session's resolved cwd
    // rather than from the encoded directory name
    const resolvedProjectPath =
      sessions.at(0)?.projectPath ?? fallbackProjectPath;

    projects.push({
      projectPath: resolvedProjectPath,
      projectDirName: dirName,
      sessionCount: sessions.length,
      turnCount: sessions.reduce((sum, s) => sum + s.turnCount, 0),
      totalInputTokens: sessions.reduce(
        (sum, s) => sum + s.totalInputTokens,
        0,
      ),
      totalOutputTokens: sessions.reduce(
        (sum, s) => sum + s.totalOutputTokens,
        0,
      ),
      totalCacheReadTokens: sessions.reduce(
        (sum, s) => sum + s.totalCacheReadTokens,
        0,
      ),
      totalCacheCreationTokens: sessions.reduce(
        (sum, s) => sum + s.totalCacheCreationTokens,
        0,
      ),
      totalCostUSD: sessions.reduce((sum, s) => sum + s.totalCostUSD, 0),
      sessions,
    });
  }

  return projects.sort((a, b) => b.totalCostUSD - a.totalCostUSD);
}

// ─── Discriminated union for mixed-type entry parsing ─────────────────────────

type AssistantParsedEntry = { type: "assistant"; data: AssistantEntry };
type UserParsedEntry = { type: "user"; data: UserEntry };
type ParsedEntry = AssistantParsedEntry | UserParsedEntry;

// Reads both user + assistant entries — needed for tool result correlation
async function readAllEntries(filePath: string): Promise<ParsedEntry[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  const entries: ParsedEntry[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;

    if (record["type"] === "assistant") {
      const result = AssistantEntrySchema.safeParse(raw);
      if (result.success)
        entries.push({ type: "assistant", data: result.data });
    } else if (record["type"] === "user") {
      const result = UserEntrySchema.safeParse(raw);
      if (result.success) entries.push({ type: "user", data: result.data });
    }
  }

  return entries;
}

function buildSessionSavingsData(
  entries: ParsedEntry[],
): SessionSavingsData | null {
  const firstAssistant = entries.find(
    (e): e is AssistantParsedEntry => e.type === "assistant",
  );
  if (firstAssistant === undefined) return null;

  const { sessionId, cwd } = firstAssistant.data;
  const projectPath = cwd ?? "unknown";

  // Global map: tool_use_id → {name, inputPreview} — built from all assistant entries
  const toolUseMap = new Map<string, { name: string; inputPreview: string }>();
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    for (const tu of extractToolUses(entry.data.message.content)) {
      toolUseMap.set(tu.id, {
        name: tu.name,
        inputPreview: getToolInputPreview(tu.name, tu.input),
      });
    }
  }

  // Map: assistant uuid → tool_result blocks from the immediately following user entry
  // Correlation works because the user reply's parentUuid === the assistant entry's uuid
  const toolResultsByParentUuid = new Map<
    string,
    ReturnType<typeof extractToolResults>
  >();
  for (const entry of entries) {
    if (entry.type !== "user") continue;
    const { parentUuid } = entry.data;
    if (parentUuid == null) continue;
    const results = extractToolResults(entry.data.message.content);
    if (results.length > 0) toolResultsByParentUuid.set(parentUuid, results);
  }

  // Sort assistant entries chronologically to get correct turn indices
  const assistantEntries = entries
    .filter((e): e is AssistantParsedEntry => e.type === "assistant")
    .sort(
      (a, b) =>
        new Date(a.data.timestamp).getTime() -
        new Date(b.data.timestamp).getTime(),
    );

  const turns: TurnSavingsData[] = assistantEntries.map((entry, index) => {
    const { content, usage } = entry.data.message;
    const toolUses = extractToolUses(content);
    const thinkingBlocks = extractThinkingBlocks(content);

    // Find tool results that correspond to this specific assistant turn
    const correspondingResults =
      toolResultsByParentUuid.get(entry.data.uuid) ?? [];
    const resultsByToolUseId = new Map(
      correspondingResults.map((r) => [r.tool_use_id, r]),
    );

    const toolCalls: ToolCallRecord[] = toolUses.map((tu) => {
      const result = resultsByToolUseId.get(tu.id);
      return {
        toolName: tu.name,
        resultTokens:
          result !== undefined ? estimateToolResultTokens(result) : 0,
        isError: result?.is_error ?? false,
        inputPreview: getToolInputPreview(tu.name, tu.input),
      };
    });

    const thinkingTokensEstimate = thinkingBlocks.reduce(
      (sum, block) => sum + estimateTokens(block.thinking),
      0,
    );

    return {
      turnIndex: index,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      toolCalls,
      thinkingTokensEstimate,
    };
  });
  const turnContextSizes = assistantEntries.map((e) => {
    const { usage } = e.data.message;
    return (
      usage.input_tokens +
      usage.cache_read_input_tokens +
      usage.cache_creation_input_tokens
    );
  });

  const firstContextSize = turnContextSizes.at(0) ?? 0;
  const lastContextSize = turnContextSizes.at(-1) ?? 0;
  const peakContextTokens = turnContextSizes.reduce(
    (max, v) => Math.max(max, v),
    0,
  );

  const contextGrowthFactor =
    firstContextSize > 0 ? lastContextSize / firstContextSize : 1;

  return {
    sessionId,
    projectPath,
    turns,
    contextGrowthFactor,
    peakContextTokens,
    hasRunawayContext:
      (contextGrowthFactor > 4 && turns.length > 15) ||
      peakContextTokens > 200_000,
  };
}

export async function loadSavingsData(): Promise<ProjectSavingsData[]> {
  let dirEntries: Dirent[];
  try {
    dirEntries = await fs.readdir(CLAUDE_PROJECTS_DIR, {
      withFileTypes: true,
    });
  } catch {
    return [];
  }

  const projects: ProjectSavingsData[] = [];

  for (const dirEntry of dirEntries) {
    if (!dirEntry.isDirectory()) continue;

    const dirPath = path.join(CLAUDE_PROJECTS_DIR, dirEntry.name);
    let fileEntries: Dirent[];
    try {
      fileEntries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    const sessions: SessionSavingsData[] = [];
    let resolvedProjectPath: string | undefined;

    for (const fileEntry of fileEntries) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith(".jsonl")) continue;
      const entries = await readAllEntries(path.join(dirPath, fileEntry.name));
      const sessionData = buildSessionSavingsData(entries);
      if (sessionData !== null) {
        sessions.push(sessionData);
        resolvedProjectPath ??= sessionData.projectPath;
      }
    }

    if (sessions.length === 0) continue;

    const projectPath = resolvedProjectPath ?? dirEntry.name;

    // .claudeignore check — if project dir is gone, access throws → hasClaudeIgnore = false
    let hasClaudeIgnore = false;
    try {
      await fs.access(path.join(projectPath, ".claudeignore"));
      hasClaudeIgnore = true;
    } catch {
      hasClaudeIgnore = false;
    }

    projects.push({ projectPath, hasClaudeIgnore, sessions });
  }

  return projects;
}

export async function loadSessionDetail(
  filePath: string,
): Promise<SessionDetail | null> {
  const entries = await readAllEntries(filePath);

  const assistantEntries = entries
    .filter((e): e is AssistantParsedEntry => e.type === "assistant")
    .sort(
      (a, b) =>
        new Date(a.data.timestamp).getTime() -
        new Date(b.data.timestamp).getTime(),
    );

  const firstEntry = assistantEntries.at(0);
  if (firstEntry === undefined) return null;

  const { sessionId, cwd } = firstEntry.data;
  const projectPath = cwd ?? "unknown";

  let totalCostUSD = 0;
  let prevTotalContextTokens = 0;

  const turns: TurnDetail[] = assistantEntries.map((entry, index) => {
    const { usage, model, content } = entry.data.message;
    const toolUses = extractToolUses(content);
    const thinkingBlocks = extractThinkingBlocks(content);

    const cost = calculateCost(usage, model);
    totalCostUSD += cost;

    const totalContextTokens =
      usage.input_tokens +
      usage.cache_read_input_tokens +
      usage.cache_creation_input_tokens;

    // index === 0: delta is the full context (no previous turn)
    const contextDelta =
      index === 0
        ? totalContextTokens
        : totalContextTokens - prevTotalContextTokens;
    prevTotalContextTokens = totalContextTokens;

    const thinkingTokensEstimate = thinkingBlocks.reduce(
      (sum, block) => sum + estimateTokens(block.thinking),
      0,
    );

    return {
      turnIndex: index,
      timestamp: new Date(entry.data.timestamp),
      freshInputTokens: usage.input_tokens,
      totalContextTokens,
      contextDelta,
      outputTokens: usage.output_tokens,
      costUSD: cost,
      model,
      toolNames: toolUses.map((tu) => tu.name),
      thinkingTokensEstimate,
    };
  });

  const firstCtx = turns.at(0)?.totalContextTokens ?? 0;
  const lastCtx = turns.at(-1)?.totalContextTokens ?? 0;
  const peakContextTokens = turns.reduce(
    (max, t) => Math.max(max, t.totalContextTokens),
    0,
  );
  const contextGrowthFactor = firstCtx > 0 ? lastCtx / firstCtx : 1;

  return {
    sessionId,
    projectPath,
    totalCostUSD,
    contextGrowthFactor,
    peakContextTokens,
    hasRunawayContext:
      (contextGrowthFactor > 4 && turns.length > 15) ||
      peakContextTokens > 200_000,
    turns,
  };
}
