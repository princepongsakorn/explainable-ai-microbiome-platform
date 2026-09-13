import { ValueUnits } from "./fidelity";

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

/**
 * SHAP's own label format: `format_value(v, "%+0.02f")`.
 *
 * Two decimals, then `re.sub(r"\.?0+$", "", s)` strips the trailing zeros, so
 * `0.10` reads `+0.1` and `2.0` reads `+2`. It also means anything below 0.005
 * collapses to `+0` or `−0`, losing both magnitude and direction — which is
 * exactly why V1 deviates from it everywhere except faithful mode, where
 * reproducing it is the requirement.
 */
function formatShapNative(v: number): string {
  const fixed = (v < 0 ? -v : v).toFixed(2);
  const stripped = fixed.replace(/\.?0+$/, "");
  // toFixed(2) of a negative that rounds to zero still yields "0.00"; the sign
  // is taken from the value, not from the formatted string, so −0 survives.
  return (v < 0 ? MINUS : "+") + (stripped === "" ? "0" : stripped);
}

/** Probability points. 0.021 -> "+2.1 pp". */
function formatPercentagePoints(v: number, decimals: ValuePrecision | 1 = 1): string {
  const points = Math.abs(v) * 100;
  return `${v < 0 ? MINUS : "+"}${points.toFixed(decimals)} pp`;
}

/**
 * Write a SHAP value in the units the chart's fidelity level calls for.
 *
 * `percentagePoints` assumes the Model output is a probability. That is not
 * true of SHAP in general — an explainer over log-odds or a raw margin would
 * make "pp" a lie — but it is guaranteed by this platform's contract, whose
 * predict returns `DataFrame[Y_proba, Y_class]`. It is the one assumption the
 * microbiome level makes about the Model, and it is why that level is opt-in.
 */
export function formatValue(
  v: number,
  units: ValueUnits,
  decimals?: ValuePrecision,
): string {
  if (units === "shap") return formatShapNative(v);
  if (units === "percentagePoints") return formatPercentagePoints(v, decimals ?? 1);
  return formatShapValue(v, decimals);
}
