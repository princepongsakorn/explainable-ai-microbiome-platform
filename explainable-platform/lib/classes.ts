import { EMPTY_VALUE } from "./format";

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

/**
 * The threshold a probability is read against when the predicted class was not
 * stored alongside it.
 *
 * Every model this platform serves is binary with 1 = positive, which is the
 * same assumption `KNOWN_LABELS` above already makes. Prefer the stored class
 * wherever there is one; this is for the places that hold only the model
 * output, such as a breakdown opened from a point on a cohort chart.
 */
export const POSITIVE_THRESHOLD = 0.5;

/** One wording for the predicted class, wherever it is shown. */
export function classificationLabel(value?: number | string | null): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  return `Probable ${classLabel(value).toLowerCase()}`;
}
