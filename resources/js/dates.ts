const formatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** A day like "2027-03-12" is read as UTC, so it never moves to the day before. */
function parts(value: string): Record<string, string> {
  // A full timestamp shows the day in the time zone of the user.
  const date = value.length === 10 ? new Date(`${value}T00:00:00Z`) : localDay(new Date(value));
  const result: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    result[part.type] = part.value;
  }
  // Some browsers write "Sept". Every month is 3 letters here.
  result.month = (result.month ?? "").slice(0, 3);
  return result;
}

function localDay(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/** Like "6 Oct 2026". Takes "YYYY-MM-DD" or a full timestamp. */
export function formatDate(value: string): string {
  const { day, month, year } = parts(value);
  return `${day} ${month} ${year}`;
}

/** Like "6 Oct 2026, 14:05", in the time zone of the user. */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${formatDate(value)}, ${String(date.getHours()).padStart(2, "0")}:${minutes}`;
}

/** Like "12 – 14 Mar 2027". The month and the year are written once when they are the same. */
export function formatDateRange(from: string, to: string): string {
  const start = parts(from);
  const end = parts(to);
  if (from === to) {
    return formatDate(from);
  }
  if (start.year !== end.year) {
    return `${formatDate(from)} – ${formatDate(to)}`;
  }
  if (start.month !== end.month) {
    return `${start.day} ${start.month} – ${formatDate(to)}`;
  }
  return `${start.day} – ${formatDate(to)}`;
}

/** Like "6 m wide × 3 m deep". Empty when no size is set. */
export function formatBoothSize(widthCm: number | null, depthCm: number | null): string {
  const sides: string[] = [];
  if (widthCm !== null) {
    sides.push(`${widthCm / 100} m wide`);
  }
  if (depthCm !== null) {
    sides.push(`${depthCm / 100} m deep`);
  }
  return sides.join(" × ");
}

const monthFormatter = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

/** "2026-10" becomes "Oct". */
export function formatMonth(month: string): string {
  return monthFormatter.format(new Date(`${month}-01T00:00:00Z`)).slice(0, 3);
}

/** Joins the parts that are not empty, like "Hall 3 · Booth B-14". */
export function joinParts(values: (string | null | undefined)[], separator = " · "): string {
  const kept: string[] = [];
  for (const value of values) {
    if (value) {
      kept.push(value);
    }
  }
  return kept.join(separator);
}

/** The small text under an item name, like "Booth · SKU BM-SB-63". */
export function itemNote(line: { category: string | null; sku?: string | null }): string {
  return joinParts([line.category, line.sku && `SKU ${line.sku}`]);
}

/** Like "3 items" or "1 item". */
export function countText(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** When something happened, in short words: "Just now", "10 minutes ago", "2 hours ago", then the date. */
export function timeAgo(value: string, now = Date.now()): string {
  const passed = now - new Date(value).getTime();
  if (passed < MINUTE_MS) {
    return "Just now";
  }
  if (passed < HOUR_MS) {
    return `${countText(Math.floor(passed / MINUTE_MS), "minute")} ago`;
  }
  if (passed < 24 * HOUR_MS) {
    return `${countText(Math.floor(passed / HOUR_MS), "hour")} ago`;
  }
  return formatDate(value);
}
