/**
 * Axis ticks, chosen the way matplotlib chooses them for SHAP's figures.
 *
 * Two rules, both read from the installed matplotlib rather than approximated:
 *
 * * How many ticks fit. `XAxis.get_tick_space` (axis.py) is
 *   `floor(axis_length_pt / (tick_label_size_pt * 3))` — the 3 is its estimate
 *   of a tick label's aspect ratio — and `MaxNLocator` (ticker.py) clips that to
 *   at most 9. Our axis length is in CSS pixels, which are 0.75 pt; the label
 *   size is SHAP's own, in points.
 * * Which step. The smallest of 1, 2, 2.5, 5 or 10 times a power of ten that
 *   covers the span in that many intervals.
 *
 * Evaluated at the size each chart is drawn inline, this reproduces the ticks on
 * SHAP's own reference figures for all three of this platform's charts — see
 * tests/ticks.test.ts. Tick density still follows axis width, as it does in
 * matplotlib, so the expanded view shows finer ticks than the inline one.
 */

const MINUS = "−";
/** CSS defines 1px as 0.75pt. */
const PX_TO_PT = 0.75;
/** MaxNLocator's upper bound on intervals when nbins is "auto". */
const MAX_TICKS = 9;
const LADDER = [1, 2, 2.5, 5, 10];

/** matplotlib's default major tick, 3.5 pt, rounded to whole pixels. */
export const TICK_LENGTH = 5;
/** Baseline of the tick labels below the axis. */
export const TICK_LABEL_DY = 18;
/** Baseline of the axis title below the axis. */
export const AXIS_TITLE_DY = 38;

export type AxisTick = { value: number; x: number; label: string };
export type AxisSpine = { x1: number; x2: number; y: number };
export type AxisTitle = { text: string; x: number; y: number; fontSize: number };

/** How many tick intervals fit along an axis, as matplotlib estimates it. */
export function tickSpace(axisPx: number, labelPt: number): number {
  const space = Math.floor((axisPx * PX_TO_PT) / (labelPt * 3));
  return Math.min(MAX_TICKS, Math.max(1, space));
}

/**
 * Round tick values across `[min, max]`, in at most `maxTicks` intervals.
 *
 * `integer` keeps every step whole. A heatmap's x axis counts Samples, and for a
 * handful of them matplotlib would happily tick at 0.5; there is no Sample 0.5.
 *
 * Ticks are `first + i * step`, not an accumulation, so a step of 0.1 does not
 * drift into 0.30000000000000004; values within a hair of zero are snapped to a
 * positive zero so no label reads "−0.0".
 */
export function niceTicks(
  min: number,
  max: number,
  maxTicks: number,
  { integer = false }: { integer?: boolean } = {},
): { ticks: number[]; step: number } {
  const span = max - min;
  if (!(span > 0) || !(maxTicks > 0)) return { ticks: [], step: 0 };

  const rough = span / maxTicks;
  let magnitude = 10 ** Math.floor(Math.log10(rough));
  let step = 0;
  // A decade may have no admissible step once integer steps are required, so
  // walk up until one fits.
  for (let decade = 0; decade < 4 && step === 0; decade++, magnitude *= 10) {
    for (const multiple of LADDER) {
      const candidate = multiple * magnitude;
      if (candidate < rough * (1 - 1e-9)) continue;
      if (integer && (candidate < 1 || Math.abs(candidate - Math.round(candidate)) > 1e-9)) {
        continue;
      }
      step = candidate;
      break;
    }
  }
  if (step === 0) return { ticks: [], step: 0 };

  const first = Math.ceil(min / step - 1e-9) * step;
  const count = Math.floor((max - first) / step + 1e-9) + 1;
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = first + i * step;
    ticks.push(Math.abs(value) < step * 1e-9 ? 0 : value);
  }
  return { ticks, step };
}

/**
 * A tick label, with as many decimals as the step needs and no more.
 *
 * A tick is a round number by construction, so "0.1" carries everything
 * "0.1000" does, and several share one axis. Negative values take the unicode
 * minus, as matplotlib's ScalarFormatter and the rest of this package do.
 */
export function tickLabel(value: number, step: number, percent = false): string {
  const scaled = percent ? value * 100 : value;
  const scaledStep = percent ? step * 100 : step;
  let decimals = 0;
  while (decimals < 6) {
    const factor = 10 ** decimals;
    if (Math.abs(scaledStep * factor - Math.round(scaledStep * factor)) < 1e-9) break;
    decimals++;
  }
  const digits = Math.abs(scaled).toFixed(decimals);
  const sign = scaled < 0 && Number(digits) !== 0 ? MINUS : "";
  return sign + digits + (percent ? "%" : "");
}
