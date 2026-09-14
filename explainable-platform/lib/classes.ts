/**
 * How a predicted class is named. The one place that knows: a class is a
 * value, and every model today is binary with 1 = positive. When a model can
 * be multi-class, or name its classes at publish time, this takes that model's
 * labels and nothing else changes.
 */
const KNOWN_LABELS: Record<string, string> = { "1": "Positive", "0": "Negative" };

export function classLabel(value: number | string): string {
  const key = String(value);
  return KNOWN_LABELS[key] ?? `Class ${key}`;
}
