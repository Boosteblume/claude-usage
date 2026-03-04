import { z } from "zod";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const ToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()).optional().default({}),
});
export type ToolUseBlock = z.infer<typeof ToolUseBlockSchema>;

const ToolResultContentItemSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

export const ToolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  // content can be a raw string or an array of typed blocks
  content: z
    .union([z.string(), z.array(ToolResultContentItemSchema)])
    .optional(),
  is_error: z.boolean().optional(),
});
export type ToolResultBlock = z.infer<typeof ToolResultBlockSchema>;

export const ThinkingBlockSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  signature: z.string().optional(),
});
export type ThinkingBlock = z.infer<typeof ThinkingBlockSchema>;

// ─── Utilities ────────────────────────────────────────────────────────────────

// ~4 chars per token — rough but consistent enough for relative comparison
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Generic block extractor — avoids repeating safeParse boilerplate
function extractBlocks<T>(content: unknown[], schema: z.ZodType<T>): T[] {
  const results: T[] = [];
  for (const block of content) {
    const parsed = schema.safeParse(block);
    if (parsed.success) results.push(parsed.data);
  }
  return results;
}

export const extractToolUses = (c: unknown[]): ToolUseBlock[] =>
  extractBlocks(c, ToolUseBlockSchema);

export const extractToolResults = (c: unknown[]): ToolResultBlock[] =>
  extractBlocks(c, ToolResultBlockSchema);

export const extractThinkingBlocks = (c: unknown[]): ThinkingBlock[] =>
  extractBlocks(c, ThinkingBlockSchema);

export function estimateToolResultTokens(block: ToolResultBlock): number {
  const { content } = block;
  if (content === undefined) return 0;
  if (typeof content === "string") return estimateTokens(content);
  return content.reduce(
    (sum, item) =>
      sum + (item.text !== undefined ? estimateTokens(item.text) : 0),
    0,
  );
}

// Tool-specific input preview — bash shows the command, file tools show the path
export function getToolInputPreview(
  name: string,
  input: Record<string, unknown>,
): string {
  if (name === "bash" && typeof input["command"] === "string") {
    return input["command"].slice(0, 100);
  }
  if (typeof input["file_path"] === "string")
    return input["file_path"].slice(0, 100);
  if (typeof input["path"] === "string") return input["path"].slice(0, 100);
  return JSON.stringify(input).slice(0, 100);
}
