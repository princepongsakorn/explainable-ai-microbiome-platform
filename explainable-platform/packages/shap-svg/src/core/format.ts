const MINUS = "−";
/** Below this magnitude, fixed notation would round away to zero at our precision. */
const EXPONENT_THRESHOLD = 1e-3;

/** How the value labels are written. Display only. */
export type ValuePrecision = 2 | 3 | 4 | "percent";

/** Decimal places a percentage is shown to. */
const PERCENT_DECIMALS = 2;

/**
 * Spec 3.5 V1. SHAP's "%0.03f" renders most relative-abundance-scale values as "0" or "-0";
 * this keeps them readable and always signs the value so a bar's direction is unambiguous.
 *
 * `decimals` fixes how the value is written for display. It does not change any
 * value that is computed from — or compared against — the payload; it only
 * changes the glyphs. Values too small to survive at that precision still fall
 * back to an exponent rather than collapsing to a signed zero, which is the
 * whole point of V1: "+0.00" hides both the magnitude and the direction.
 *
 * "percent" moves the decimal point two places and adds a sign. It reaches a
 * range the fixed-decimal settings cannot: a contribution of 0.0003 is an
 * exponent at two decimals but an ordinary 0.03%, which is most of this data.
 */
export function formatShapValue(v: number, decimals?: ValuePrecision): string {
  if (v === 0) return "0";
  return (v < 0 ? MINUS : "+") + magnitudeOf(v, decimals);
}

/**
 * A value on the model's output scale: `E[f(X)]` and `f(x)`.
 *
 * Unsigned, unlike a contribution. SHAP draws the same distinction —
 * `_waterfall.py:327,339` format these with `"%0.03f"` and only the bar
 * contributions with `"%+0.02f"` — and it matters: a leading "+" on a model
 * output reads as "went up by", when the number is where the prediction landed,
 * not how far it moved. A minus is still kept, because nothing guarantees a
 * model output is a probability.
 */
export function formatLevel(v: number, decimals?: ValuePrecision): string {
  if (v === 0) return "0";
  return (v < 0 ? MINUS : "") + magnitudeOf(v, decimals);
}

/** The digits both formatters share; the caller owns the sign. */
function magnitudeOf(v: number, decimals?: ValuePrecision): string {
  const magnitude = Math.abs(v);

  if (decimals === undefined) {
    return magnitude < EXPONENT_THRESHOLD
      ? magnitude.toExponential(0)
      : String(Number(magnitude.toPrecision(3)));
  }

  const places = decimals === "percent" ? PERCENT_DECIMALS : decimals;
  const scaled = decimals === "percent" ? magnitude * 100 : magnitude;
  const unit = decimals === "percent" ? "%" : "";

  // Half of the last retained place: anything under it rounds to all zeros.
  // The unit is dropped along with the fixed notation, because "1e-7%" reads
  // as a percentage of a percentage.
  if (scaled < 0.5 * 10 ** -places) return magnitude.toExponential(0);
  return scaled.toFixed(places) + unit;
}

/** Spec 3.5 V3. The italic styling is applied by the renderer, not here. */
export function formatFeatureLabel(name: string): string {
  return name.replace(/_/g, " ");
}
