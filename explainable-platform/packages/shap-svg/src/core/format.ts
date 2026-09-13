const MINUS = "−";
/** Below this magnitude, fixed notation would round away to zero at our precision. */
const EXPONENT_THRESHOLD = 1e-3;

/** Decimal places the value labels can be rendered at. Display only. */
export type ValuePrecision = 2 | 3 | 4;

/**
 * Spec 3.5 V1. SHAP's "%0.03f" renders most relative-abundance-scale values as "0" or "-0";
 * this keeps them readable and always signs the value so a bar's direction is unambiguous.
 *
 * `decimals` fixes the number of decimal places for display. It does not change
 * any value that is computed from — or compared against — the payload; it only
 * changes the glyphs. Values too small to survive at that precision still fall
 * back to an exponent rather than collapsing to a signed zero, which is the
 * whole point of V1: "+0.00" hides both the magnitude and the direction.
 */
export function formatShapValue(v: number, decimals?: ValuePrecision): string {
  if (v === 0) return "0";
  const magnitude = Math.abs(v);
  const sign = v < 0 ? MINUS : "+";

  if (decimals === undefined) {
    const body = magnitude < EXPONENT_THRESHOLD
      ? magnitude.toExponential(0)
      : String(Number(magnitude.toPrecision(3)));
    return sign + body;
  }

  // Half of the last retained place: anything under it rounds to all zeros.
  const smallestShown = 0.5 * 10 ** -decimals;
  const body = magnitude < smallestShown
    ? magnitude.toExponential(0)
    : magnitude.toFixed(decimals);
  return sign + body;
}

/** Spec 3.5 V3. The italic styling is applied by the renderer, not here. */
export function formatFeatureLabel(name: string): string {
  return name.replace(/_/g, " ");
}
