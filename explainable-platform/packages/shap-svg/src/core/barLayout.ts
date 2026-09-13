import { DisplayRows } from "./types";

import { ZeroHandling } from "./fidelity";

export const POSITIVE_COLOR = "#ff0051";
export const NEGATIVE_COLOR = "#008bfb";
/** SHAP's own grey, reused for "this Feature contributed nothing". */
export const NEUTRAL_COLOR = "#848484";

/**
 * Bar colour for a contribution.
 *
 * SHAP's rule is `value > 0 ? red : blue` (`_bar.py:267-271`), which paints an
 * exactly-zero contribution blue — the same zero the waterfall paints red. Only
 * the faithful level keeps that; above it a zero is grey, because it did not
 * push the prediction either way and neither colour says so.
 */
export function colorFor(value: number, zeroHandling: ZeroHandling = "shapPerChart") {
  if (value === 0 && zeroHandling === "neutral") return NEUTRAL_COLOR;
  return value > 0 ? POSITIVE_COLOR : NEGATIVE_COLOR;
}

/** shap/plots/_bar.py:259 — total_width 0.7 of the row pitch. */
const BAR_THICKNESS_RATIO = 0.7;
/** Room below the last row for the x axis. */
const AXIS_HEIGHT = 30;

export type BarLayoutOptions = {
  width: number;
  rowHeight: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  /** How an exactly-zero contribution is coloured. Set by the fidelity level. */
  zeroHandling?: ZeroHandling;
};

export type BarGeometry = {
  label: string;
  featureIndex: number | null;
  isOtherRow: boolean;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** vertical centre of the row, for label baselines */
  centerY: number;
};

export type BarLayout = {
  bars: BarGeometry[];
  xDomain: [number, number];
  xZero: number;
  plotWidth: number;
  height: number;
  showZeroRule: boolean;
};

export function barLayout(rows: DisplayRows, opts: BarLayoutOptions): BarLayout {
  const { width, rowHeight, marginLeft, marginRight, marginTop } = opts;
  const plotWidth = width - marginLeft - marginRight;

  const values = rows.rows.map((r) => r.value);
  // Zero must always be in the domain, otherwise a bar would not start at the axis.
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const toX = (v: number) => marginLeft + ((v - min) / span) * plotWidth;
  const xZero = toX(0);

  const barHeight = rowHeight * BAR_THICKNESS_RATIO;
  const inset = (rowHeight - barHeight) / 2;

  const bars: BarGeometry[] = rows.rows.map((row, i) => {
    const rowTop = marginTop + i * rowHeight;
    const end = toX(row.value);
    // shap/plots/_bar.py:267-271 colours a value of exactly zero as negative.
    const positive = row.value > 0;
    return {
      label: row.label,
      featureIndex: row.featureIndex,
      isOtherRow: row.isOtherRow,
      value: row.value,
      x: positive ? xZero : end,
      y: rowTop + inset,
      width: Math.abs(end - xZero),
      height: barHeight,
      color: colorFor(row.value, opts.zeroHandling),
      centerY: rowTop + rowHeight / 2,
    };
  });

  return {
    bars,
    xDomain: [min, max],
    xZero,
    plotWidth,
    height: marginTop + rows.rows.length * rowHeight + AXIS_HEIGHT,
    // shap/plots/_bar.py:252-254 — the rule only appears when something is negative.
    showZeroRule: values.some((v) => v < 0),
  };
}
