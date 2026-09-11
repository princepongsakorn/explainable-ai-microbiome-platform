const MINUS = "−";
/** Below this magnitude, fixed notation would round away to zero at our precision. */
const EXPONENT_THRESHOLD = 1e-3;

/**
 * Spec 3.5 V1. SHAP's "%0.03f" renders most relative-abundance-scale values as "0" or "-0";
 * this keeps them readable and always signs the value so a bar's direction is unambiguous.
 */
export function formatShapValue(v: number): string {
  if (v === 0) return "0";
  const magnitude = Math.abs(v);
  const body = magnitude < EXPONENT_THRESHOLD
    ? magnitude.toExponential(0)
    : String(Number(magnitude.toPrecision(3)));
  return (v < 0 ? MINUS : "+") + body;
}

/** Spec 3.5 V3. The italic styling is applied by the renderer, not here. */
export function formatFeatureLabel(name: string): string {
  return name.replace(/_/g, " ");
}
