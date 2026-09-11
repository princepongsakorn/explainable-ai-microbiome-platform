import { DisplayRows } from "./types";

export const POSITIVE_COLOR = "#ff0051";
export const NEGATIVE_COLOR = "#008bfb";

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
      color: positive ? POSITIVE_COLOR : NEGATIVE_COLOR,
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
