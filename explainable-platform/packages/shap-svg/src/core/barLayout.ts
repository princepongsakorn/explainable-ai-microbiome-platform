import { DisplayRows } from "./types";
import {
  AXIS_TITLE_DY,
  AxisSpine,
  AxisTick,
  AxisTitle,
  niceTicks,
  tickLabel,
  tickSpace,
} from "./ticks";

export const POSITIVE_COLOR = "#ff0051";
export const NEGATIVE_COLOR = "#008bfb";

/** shap/plots/_bar.py:259 — total_width 0.7 of the row pitch. */
const BAR_THICKNESS_RATIO = 0.7;
/** Room below the last row for ticks, their labels and the axis title. */
const AXIS_HEIGHT = 52;
/** _bar.py:331 tick_params("x", labelsize=11). */
const TICK_LABEL_PT = 11;
/** _bar.py:345 set_xlabel(xlabel, fontsize=13). */
const TITLE_PT = 13;
/** matplotlib's default axes.xmargin, and _bar.py:334's own x_buffer ratio. */
const X_MARGIN = 0.05;

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
  /** Bottom edge of the last row, where the axis area begins. */
  plotBottom: number;
  xTicks: AxisTick[];
  /** The bottom spine, which _bar.py:327-330 never hides. */
  xSpine: AxisSpine | null;
  xTitle: AxisTitle;
  /**
   * The solid vertical at zero. Always present, because SHAP's two code paths
   * converge on it: _bar.py:252-254 draws axvline(0) when a value is negative,
   * and _bar.py:329-330 hides the left spine only in that same case. With no
   * negatives the spine stays and barh pins the axes' left edge to 0 — so
   * either way there is one line at zero. Mean |SHAP| is never negative, so the
   * summary chart always takes the spine path.
   */
  zeroLine: { x: number; y1: number; y2: number };
  height: number;
};

function barXAxis(
  min: number,
  max: number,
  toX: (value: number) => number,
  marginLeft: number,
  plotWidth: number,
  plotBottom: number,
): Pick<BarLayout, "xTicks" | "xSpine" | "xTitle"> {
  const { ticks, step } = niceTicks(min, max, tickSpace(plotWidth, TICK_LABEL_PT));
  return {
    xTicks: ticks.map((value) => ({ value, x: toX(value), label: tickLabel(value, step) })),
    xSpine: { x1: marginLeft, x2: marginLeft + plotWidth, y: plotBottom },
    xTitle: {
      // _bar.py:143-150 builds this from the Explanation's transform history:
      // "SHAP value" -> "|SHAP value|" -> "mean(|SHAP value|)".
      text: "mean(|SHAP value|)",
      x: marginLeft + plotWidth / 2,
      y: plotBottom + AXIS_TITLE_DY,
      fontSize: TITLE_PT,
    },
  };
}

export function barLayout(rows: DisplayRows, opts: BarLayoutOptions): BarLayout {
  const { width, rowHeight, marginLeft, marginRight, marginTop } = opts;
  const plotWidth = width - marginLeft - marginRight;

  const values = rows.rows.map((r) => r.value);
  // Zero must always be in the domain, otherwise a bar would not start at the axis.
  const dataMin = Math.min(0, ...values);
  const dataMax = Math.max(0, ...values);
  const dataSpan = dataMax - dataMin;
  const negative = values.some((v) => v < 0);

  // Two 5% pads, measured by running shap.plots.bar: xlim came back as
  // max * 1.05 * 1.05. matplotlib's autoscale pads first — barh pins the edge
  // that sits at zero, so with nothing negative only the right grows — and
  // _bar.py:334-340 then reads that padded xlim and adds a 5% buffer of it:
  // to the right only, unless something is negative, then to both sides.
  const autoMin = negative ? dataMin - dataSpan * X_MARGIN : dataMin;
  const autoMax = dataMax + dataSpan * X_MARGIN;
  const buffer = (autoMax - autoMin) * X_MARGIN;
  const min = negative ? autoMin - buffer : autoMin;
  const max = autoMax + buffer;
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
    plotBottom: marginTop + rows.rows.length * rowHeight,
    ...barXAxis(min, max, toX, marginLeft, plotWidth, marginTop + rows.rows.length * rowHeight),
    zeroLine: { x: xZero, y1: marginTop, y2: marginTop + rows.rows.length * rowHeight },
    height: marginTop + rows.rows.length * rowHeight + AXIS_HEIGHT,
  };
}
