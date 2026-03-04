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
  // .split()[0] is string | undefined under noUncheckedIndexedAccess — use .at()
  return date.toISOString().split("T").at(0) ?? "—";
}

export function formatDateRange(dates: Date[]): string {
  if (dates.length === 0) return "—";

  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());

  // .at() returns T | undefined even on non-empty arrays — guard both
  const first = sorted.at(0);
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) return "—";

  const firstStr = formatDate(first);
  const lastStr = formatDate(last);

  return firstStr === lastStr ? firstStr : `${firstStr} → ${lastStr}`;
}
