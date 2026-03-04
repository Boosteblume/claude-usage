export const indent = (s: string): string =>
  s
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

export function formatCost(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(usd);
}

export function formatPercent(value: number, total: number): string {
  if (total === 0) return "—";
  return `${((value / total) * 100).toFixed(1)}%`;
}

export function formatDate(date: Date): string {
  return date.toISOString().split("T").at(0) ?? "—";
}

export function formatDateRange(dates: Date[]): string {
  if (dates.length === 0) return "—";
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const first = sorted.at(0);
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) return "—";
  const firstStr = formatDate(first);
  const lastStr = formatDate(last);
  return firstStr === lastStr ? firstStr : `${firstStr} → ${lastStr}`;
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

// Downsample values to targetLength by picking evenly-spaced elements
function resampleValues(values: number[], targetLength: number): number[] {
  if (targetLength <= 0) return [];
  const result: number[] = [];
  const step = values.length / targetLength;
  for (let i = 0; i < targetLength; i++) {
    // noUncheckedIndexedAccess: string[] index returns number | undefined
    const src = values[Math.floor(i * step)];
    result.push(src ?? 0);
  }
  return result;
}

export function formatSparkline(values: number[], maxWidth = 20): string {
  if (values.length === 0) return "—";

  const samples =
    values.length > maxWidth ? resampleValues(values, maxWidth) : values;
  if (samples.length === 0) return "—";

  // .reduce() avoids the stack overflow of Math.min(...bigArray)
  const min = samples.reduce((a, b) => (b < a ? b : a), Infinity);
  const max = samples.reduce((a, b) => (b > a ? b : a), -Infinity);

  if (!isFinite(min) || !isFinite(max)) return "—";
  if (max === min) return samples.map(() => "▄").join("");

  return samples
    .map((v) => {
      const ratio = (v - min) / (max - min);
      const index = Math.min(
        Math.floor(ratio * SPARK_CHARS.length),
        SPARK_CHARS.length - 1,
      );
      // noUncheckedIndexedAccess: string index returns string | undefined
      return SPARK_CHARS[index] ?? "▄";
    })
    .join("");
}

// ─── ISO week ─────────────────────────────────────────────────────────────────

// ISO 8601: week 1 is the week containing the first Thursday of the year
export function getISOWeekLabel(date: Date): string {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() || 7; // Sun = 0 → 7 for ISO alignment
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // shift to Thursday of same week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
