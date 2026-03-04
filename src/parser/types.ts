import { z } from "zod";

export const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_input_tokens: z.number().int().nonnegative().default(0),
  cache_creation_input_tokens: z.number().int().nonnegative().default(0),
  cache_creation: z
    .object({
      ephemeral_5m_input_tokens: z.number().int().nonnegative().default(0),
      ephemeral_1h_input_tokens: z.number().int().nonnegative().default(0),
    })
    .optional(),
  service_tier: z.string().optional(),
  inference_geo: z.string().optional(),
});
export type Usage = z.infer<typeof UsageSchema>;

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

export const AssistantEntrySchema = z.object({
  type: z.literal("assistant"),
  uuid: z.string(),
  parentUuid: z.string().nullable().optional(),
  sessionId: z.string(),
  timestamp: z.string(),
  requestId: z.string().optional(),
  isSidechain: z.boolean().optional(),
  userType: z.string().optional(),
  cwd: z.string().optional(),
  version: z.string().optional(),
  gitBranch: z.string().optional(),
  message: AssistantAPIMessageSchema,
});
export type AssistantEntry = z.infer<typeof AssistantEntrySchema>;

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

// ─── Aggregated stats (loadAllProjects) ───────────────────────────────────────

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
  // Total context = input + cache_read + cache_creation per turn
  contextGrowthFactor: number;
  peakContextTokens: number;
  hasRunawayContext: boolean;
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

// ─── Savings analysis (loadSavingsData) ───────────────────────────────────────

export interface ToolCallRecord {
  toolName: string;
  resultTokens: number;
  isError: boolean;
  inputPreview: string;
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
  contextGrowthFactor: number;
  peakContextTokens: number;
}

export interface ProjectSavingsData {
  projectPath: string;
  hasClaudeIgnore: boolean;
  sessions: SessionSavingsData[];
}

// ─── Session detail (loadSessionDetail) ───────────────────────────────────────

export interface TurnDetail {
  turnIndex: number;
  timestamp: Date;
  freshInputTokens: number;
  totalContextTokens: number;
  contextDelta: number; // negative = /clear or /compact happened
  outputTokens: number;
  costUSD: number;
  model: string;
  toolNames: string[];
  thinkingTokensEstimate: number;
}

export interface SessionDetail {
  sessionId: string;
  projectPath: string;
  totalCostUSD: number;
  contextGrowthFactor: number;
  peakContextTokens: number;
  hasRunawayContext: boolean;
  turns: TurnDetail[];
}
