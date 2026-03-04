import { z } from "zod";

// ─── Usage ──────────────────────────────────────────────────────────────────

export const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_input_tokens: z.number().int().nonnegative().default(0),
  cache_creation_input_tokens: z.number().int().nonnegative().default(0),
  // Nested breakdown of cache creation by tier — present in newer Claude Code versions
  cache_creation: z
    .object({
      ephemeral_5m_input_tokens: z.number().int().nonnegative().default(0),
      ephemeral_1h_input_tokens: z.number().int().nonnegative().default(0),
    })
    .optional(),
  // Extra fields present in real entries — not used yet, passthrough silently
  service_tier: z.string().optional(),
  inference_geo: z.string().optional(),
});

export type Usage = z.infer<typeof UsageSchema>;

// ─── API Message ─────────────────────────────────────────────────────────────

export const AssistantAPIMessageSchema = z.object({
  id: z.string(),
  type: z.literal("message"),
  role: z.literal("assistant"),
  model: z.string(),
  content: z.array(z.unknown()),
  stop_reason: z.string().nullable().optional(),
  stop_sequence: z.string().nullable().optional(),
  usage: UsageSchema,
});

export type AssistantAPIMessage = z.infer<typeof AssistantAPIMessageSchema>;

// ─── JSONL Entry ─────────────────────────────────────────────────────────────

export const AssistantEntrySchema = z.object({
  type: z.literal("assistant"),
  uuid: z.string(),
  parentUuid: z.string().nullable().optional(),
  sessionId: z.string(),
  timestamp: z.string(),
  requestId: z.string().optional(),
  // Fields present in real entries that were missing from original schema
  isSidechain: z.boolean().optional(),
  userType: z.string().optional(),
  cwd: z.string().optional(),
  version: z.string().optional(),
  gitBranch: z.string().optional(),
  // costUSD and durationMs do NOT exist in the actual JSONL format
  // Cost is derived in reader.ts from token counts + model pricing table
  message: AssistantAPIMessageSchema,
});

export type AssistantEntry = z.infer<typeof AssistantEntrySchema>;

// ─── Aggregated Data ─────────────────────────────────────────────────────────

export interface SessionStats {
  sessionId: string;
  projectPath: string;
  filePath: string;
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUSD: number;
  startedAt: Date;
  lastActiveAt: Date;
}

export interface ProjectStats {
  projectPath: string;
  projectDirName: string;
  sessionCount: number;
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUSD: number;
  sessions: SessionStats[];
}

// ─── User Entry ───────────────────────────────────────────────────────────────

export const UserEntrySchema = z.object({
  type: z.literal("user"),
  uuid: z.string(),
  parentUuid: z.string().nullable().optional(),
  sessionId: z.string(),
  timestamp: z.string(),
  cwd: z.string().optional(),
  version: z.string().optional(),
  isSidechain: z.boolean().optional(),
  message: z.object({
    role: z.literal("user"),
    content: z.array(z.unknown()),
  }),
});

export type UserEntry = z.infer<typeof UserEntrySchema>;

// ─── Savings Analysis ─────────────────────────────────────────────────────────

export interface ToolCallRecord {
  toolName: string;
  resultTokens: number; // estimated via chars/4
  isError: boolean;
  inputPreview: string; // truncated tool input for display
}

export interface TurnSavingsData {
  turnIndex: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: ToolCallRecord[];
  thinkingTokensEstimate: number;
}

export interface SessionSavingsData {
  sessionId: string;
  projectPath: string;
  turns: TurnSavingsData[];
  hasRunawayContext: boolean;
  contextGrowthFactor: number; // lastTurn.inputTokens / firstTurn.inputTokens
}

export interface ProjectSavingsData {
  projectPath: string;
  hasClaudeIgnore: boolean;
  sessions: SessionSavingsData[];
}
