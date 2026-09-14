// The interface copy is English only, so dates and numbers are English too. A
// Thai-locale browser would otherwise mix Thai month names and Buddhist-era
// years into English sentences.
const LOCALE = "en-GB";

/** Shown wherever a value is missing. A real 0 is a value and is shown as 0. */
export const EMPTY_VALUE = "—";

const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: "medium",
  timeStyle: "short",
});
const dateFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" });
const percentFormat = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const numberFormat = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 4,
});
const secondsFormat = new Intl.NumberFormat(LOCALE, {
  style: "unit",
  unit: "second",
  unitDisplay: "narrow",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const relativeFormat = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isMissing(value: unknown): value is null | undefined | "" {
  return value === null || value === undefined || value === "";
}

/** "14 Sept 2026, 16:42" in the viewer's own time zone. */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  return date ? dateTimeFormat.format(date) : EMPTY_VALUE;
}

/** "14 Sept 2026". */
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  return date ? dateFormat.format(date) : EMPTY_VALUE;
}

/** "3 minutes ago", "yesterday". */
export function formatRelativeTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY_VALUE;

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return relativeFormat.format(Math.round(seconds / size), unit);
    }
  }
  return relativeFormat.format(seconds, "second");
}

/** A 0–1 probability as "87.3%". */
export function formatPercent(value: number | string | null | undefined): string {
  if (isMissing(value)) return EMPTY_VALUE;
  const number = Number(value);
  return Number.isFinite(number) ? percentFormat.format(number) : EMPTY_VALUE;
}

/** The time between two instants as "12.3s". */
export function formatDuration(start: DateInput, end: DateInput): string {
  const from = toDate(start);
  const to = toDate(end);
  if (!from || !to) return EMPTY_VALUE;
  return secondsFormat.format((to.getTime() - from.getTime()) / 1000);
}

/**
 * A metric, parameter or table cell. Numbers are grouped and rounded to four
 * places; anything else is shown as it came. Only a missing value becomes the
 * placeholder, unlike `value || "-"`, which also hid every 0.
 */
export function displayValue(value: unknown): string {
  if (isMissing(value)) return EMPTY_VALUE;
  if (typeof value === "number") return numberFormat.format(value);
  return String(value);
}
