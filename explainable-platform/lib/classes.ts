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

/**
 * How near the threshold a derived class stops being claimed.
 *
 * `docs/shap-explain-spec.md` §1.4 writes the explanation's numbers at four
 * significant figures and its invariant I3 holds additivity only to 1e-3
 * absolute. A Model output recovered from that payload is therefore good to
 * about 1e-3, which is exactly the width in which a derived class could
 * contradict the stored one. Inside it, say nothing.
 */
export const CLASS_UNCERTAIN_MARGIN = 1e-3;

/** One wording for the predicted class, wherever it is shown. */
export function classificationLabel(value?: number | string | null): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  return `Probable ${classLabel(value).toLowerCase()}`;
}
