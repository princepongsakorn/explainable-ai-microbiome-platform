/**
 * How a predicted class is named and coloured. The one place that knows: a
 * class is a value, and every model today is binary with 1 = positive. When a
 * model can be multi-class, or name its classes at publish time, these take
 * that model's labels and nothing else changes.
 */
const KNOWN_LABELS: Record<string, string> = { "1": "Positive", "0": "Negative" };
const KNOWN_COLORS: Record<string, string> = { "1": "bg-rose-500", "0": "bg-sky-500" };
const OTHER_COLORS = ["bg-violet-500", "bg-amber-500", "bg-teal-500", "bg-slate-500"];

export function classLabel(value: number | string): string {
  const key = String(value);
  return KNOWN_LABELS[key] ?? `Class ${key}`;
}

/** A class's colour, fixed by its value so it matches across predictions. */
export function classColor(value: number | string): string {
  const key = String(value);
  return KNOWN_COLORS[key] ?? OTHER_COLORS[Math.abs(Number(key)) % OTHER_COLORS.length];
}
