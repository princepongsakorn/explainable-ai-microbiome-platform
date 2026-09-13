import { collapseToDisplay } from "./collapse";
import { sampleColormap } from "./colormap";
import { formatShapValue } from "./format";
import {
  AXIS_TITLE_DY,
  AxisSpine,
  AxisTick,
  AxisTitle,
  niceTicks,
  tickLabel,
  tickSpace,
} from "./ticks";
import { globalImportance, orderFeatures } from "./order";
import { ParsedExplanation } from "./types";

const FX_TOP = 8;
const FX_BOTTOM_GAP = 12;
const SEPARATOR_GAP = 4;
const SIDE_BAR_GAP = 10;
const SIDE_BAR_RIGHT_INSET = 40;
const SIDE_BAR_HEIGHT_RATIO = 0.6;
/** Room below the grid for ticks, their labels and the Instances title. */
const AXIS_HEIGHT = 52;
/** _heatmap.py leaves x tick labels at matplotlib's default "medium", 10 pt. */
const TICK_LABEL_PT = 10;

export type HeatmapCell = {
  /** Original index in the Explanation, before Sample ordering. */
  sampleIndex: number;
  /** Full-precision SHAP value represented by this cell. */
  value: number;
  /** Value after clipping to the shared symmetric colour domain. */
  colorValue: number;
  color: string;
};

export type HeatmapColumn = {
  sampleIndex: number;
  sampleId?: string;
  /** Sum of all SHAP values for this Sample. */
  total: number;
};

export type HeatmapRow = {
  label: string;
  featureIndex: number | null;
  isOtherRow: boolean;
  importance: number;
  /** Importance divided by the largest displayed-row importance. */
  sideBarValue: number;
  cells: HeatmapCell[];
};

export type HeatmapRows = {
  /** Feature rows in top-to-bottom display order. */
  rows: HeatmapRow[];
  /** Sample columns in descending total-attribution order. */
  columns: HeatmapColumn[];
  /** Sample totals in the same order as columns. */
  fxLine: number[];
  vmin: number;
  vmax: number;
  collapsedCount: number;
};

export type HeatmapLayoutOptions = {
  width: number;
  rowHeight: number;
  marginLeft: number;
  marginRight: number;
  /** Top of the matrix; the f(x) line occupies the space above it. */
  marginTop: number;
};

export type HeatmapCellGeometry = HeatmapCell & {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HeatmapSideBarGeometry = {
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HeatmapRowGeometry = Omit<HeatmapRow, "cells"> & {
  centerY: number;
  cells: HeatmapCellGeometry[];
  sideBar: HeatmapSideBarGeometry;
};

export type HeatmapColumnGeometry = HeatmapColumn & {
  x: number;
  centerX: number;
  width: number;
};

export type HeatmapLinePoint = {
  sampleIndex: number;
  sampleId?: string;
  value: number;
  x: number;
  y: number;
};

export type HeatmapAxisMark = {
  value: number;
  y: number;
  label: string;
};

export type HeatmapSpine = { x: number; y1: number; y2: number };

/** An outward tick on the left edge, one per Feature row. */
export type HeatmapYTick = { y: number; x1: number; x2: number };

/** matplotlib's default major tick, 3.5 pt, at the 100 dpi SHAP renders at. */
const Y_TICK_LENGTH = 5;

export type HeatmapLayout = {
  rows: HeatmapRowGeometry[];
  columns: HeatmapColumnGeometry[];
  fxLine: HeatmapLinePoint[];
  fxAxisMarks: HeatmapAxisMark[];
  fxDomain: [number, number];
  separatorY: number;
  gridLeft: number;
  gridRight: number;
  gridTop: number;
  plotBottom: number;
  /**
   * _heatmap.py:135 shows the left and right spines (and hides top and bottom),
   * and :136 bounds them with set_bounds(n - row_height, -row_height). With
   * row_height = 0.5 (:116) that is exactly the outer edge of the first and last
   * row — so they frame the grid and stop short of the f(x) chart above it. The
   * side bars are drawn with clip_on=False (:173), outside the right spine.
   */
  spines: { left: HeatmapSpine; right: HeatmapSpine };
  /** yaxis.set_ticks_position("left") with tick_params(direction="out"), :134,:138. */
  yTicks: HeatmapYTick[];
  /** Ticks along the Sample axis, at the centre of each ticked column. */
  xTicks: AxisTick[];
  /** Always null: _heatmap.py:137 hides the bottom spine. */
  xSpine: AxisSpine | null;
  xTitle: AxisTitle;
  plotWidth: number;
  cellWidth: number;
  height: number;
};

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

/** Computes the SHAP-compatible orderings, collapse, colours, line, and side bars in value space. */
export function heatmapRows(
  explanation: ParsedExplanation,
  maxDisplay: number,
  faithfulOtherRow: boolean,
): HeatmapRows {
  if (!Number.isInteger(maxDisplay) || maxDisplay <= 0) {
    throw new RangeError(`maxDisplay must be a positive integer, received ${maxDisplay}`);
  }

  const importance = globalImportance(explanation);
  const featureOrder = orderFeatures(importance);
  const display = collapseToDisplay(
    explanation.featureNames,
    importance,
    featureOrder,
    maxDisplay,
    faithfulOtherRow,
  );
  const displayedFeatures = new Set(
    display.rows.flatMap((row) => row.featureIndex === null ? [] : [row.featureIndex]),
  );
  const collapsedFeatures = featureOrder.filter((index) => !displayedFeatures.has(index));

  const columns = explanation.values
    .map((sample, sampleIndex): HeatmapColumn => ({
      sampleIndex,
      sampleId: explanation.sampleIds?.[sampleIndex],
      total: sample.reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => (b.total - a.total) || (a.sampleIndex - b.sampleIndex));

  const uncolouredRows = display.rows.map((displayRow) => {
    const featureIndices = displayRow.featureIndex === null
      ? collapsedFeatures
      : [displayRow.featureIndex];
    return {
      displayRow,
      cells: columns.map((column) => ({
        sampleIndex: column.sampleIndex,
        value: featureIndices.reduce(
          (sum, featureIndex) => sum + explanation.values[column.sampleIndex][featureIndex],
          0,
        ),
      })),
    };
  });

  const allCells = uncolouredRows.flatMap((row) => row.cells.map((cell) => cell.value));
  const lower = percentile(allCells, 0.01);
  const upper = percentile(allCells, 0.99);
  const limit = Math.max(-lower, upper, 0);
  const vmin = limit === 0 ? 0 : -limit;
  const vmax = limit;
  const largestImportance = Math.max(0, ...display.rows.map((row) => row.value));

  const rows = uncolouredRows.map(({ displayRow, cells }): HeatmapRow => ({
    label: displayRow.label,
    featureIndex: displayRow.featureIndex,
    isOtherRow: displayRow.isOtherRow,
    importance: displayRow.value,
    sideBarValue: largestImportance === 0 ? 0 : displayRow.value / largestImportance,
    cells: cells.map((cell): HeatmapCell => {
      const colorValue = limit === 0
        ? 0
        : Math.max(-limit, Math.min(limit, cell.value));
      const normalized = limit === 0 ? 0.5 : (colorValue + limit) / (2 * limit);
      return {
        ...cell,
        colorValue,
        color: sampleColormap("red_white_blue", normalized),
      };
    }),
  }));

  return {
    rows,
    columns,
    fxLine: columns.map((column) => column.total),
    vmin,
    vmax,
    collapsedCount: display.collapsedCount,
  };
}

/**
 * The Sample axis. xlim(-0.5, n - 0.5) at _heatmap.py:151 puts integer i at the
 * centre of column i, so a tick's position is its column's centre. Integer steps
 * only: the axis counts Samples, and for a handful of them there is no Sample 0.5.
 */
function heatmapXAxis(
  sampleCount: number,
  marginLeft: number,
  cellWidth: number,
  plotWidth: number,
  plotBottom: number,
): Pick<HeatmapLayout, "xTicks" | "xSpine" | "xTitle"> {
  const { ticks, step } = niceTicks(
    -0.5,
    sampleCount - 0.5,
    tickSpace(plotWidth, TICK_LABEL_PT),
    { integer: true },
  );
  return {
    xTicks: ticks.map((value) => ({
      value,
      x: marginLeft + (value + 0.5) * cellWidth,
      label: tickLabel(value, step),
    })),
    xSpine: null,
    xTitle: {
      text: "Instances",
      x: marginLeft + plotWidth / 2,
      y: plotBottom + AXIS_TITLE_DY,
      fontSize: TICK_LABEL_PT,
    },
  };
}

/** Projects heatmap value-space rows into SVG geometry. */
export function heatmapLayout(
  valueRows: HeatmapRows,
  opts: HeatmapLayoutOptions,
): HeatmapLayout {
  const { width, rowHeight, marginLeft, marginRight, marginTop } = opts;
  const plotWidth = width - marginLeft - marginRight;
  const cellWidth = valueRows.columns.length === 0 ? 0 : plotWidth / valueRows.columns.length;
  const gridRight = marginLeft + plotWidth;
  const plotBottom = marginTop + valueRows.rows.length * rowHeight;
  const sideBarWidth = Math.max(0, marginRight - SIDE_BAR_RIGHT_INSET - SIDE_BAR_GAP);

  const columns = valueRows.columns.map((column, index): HeatmapColumnGeometry => ({
    ...column,
    x: marginLeft + index * cellWidth,
    centerX: marginLeft + (index + 0.5) * cellWidth,
    width: cellWidth,
  }));

  const rows = valueRows.rows.map((row, rowIndex): HeatmapRowGeometry => {
    const y = marginTop + rowIndex * rowHeight;
    const centerY = y + rowHeight / 2;
    const barHeight = rowHeight * SIDE_BAR_HEIGHT_RATIO;
    return {
      ...row,
      centerY,
      cells: row.cells.map((cell, columnIndex): HeatmapCellGeometry => ({
        ...cell,
        x: marginLeft + columnIndex * cellWidth,
        y,
        width: cellWidth,
        height: rowHeight,
      })),
      sideBar: {
        value: row.sideBarValue,
        x: gridRight + SIDE_BAR_GAP,
        y: centerY - barHeight / 2,
        width: row.sideBarValue * sideBarWidth,
        height: barHeight,
      },
    };
  });

  const fxMin = Math.min(0, ...valueRows.fxLine);
  const fxMax = Math.max(0, ...valueRows.fxLine);
  const fxSpan = fxMax - fxMin || 1;
  const fxBottom = Math.max(FX_TOP, marginTop - FX_BOTTOM_GAP);
  const toY = (value: number) => FX_TOP + (fxMax - value) / fxSpan * (fxBottom - FX_TOP);
  const fxLine = columns.map((column, index): HeatmapLinePoint => ({
    sampleIndex: column.sampleIndex,
    sampleId: column.sampleId,
    value: valueRows.fxLine[index],
    x: column.centerX,
    y: toY(valueRows.fxLine[index]),
  }));
  const axisValues = [fxMax, 0, fxMin].filter(
    (value, index, values) => values.indexOf(value) === index,
  );

  return {
    rows,
    columns,
    fxLine,
    fxAxisMarks: axisValues.map((value) => ({
      value,
      y: toY(value),
      label: formatShapValue(value),
    })),
    fxDomain: [fxMin, fxMax],
    separatorY: marginTop - SEPARATOR_GAP,
    gridLeft: marginLeft,
    gridRight,
    gridTop: marginTop,
    plotBottom,
    spines: {
      left: { x: marginLeft, y1: marginTop, y2: plotBottom },
      right: { x: gridRight, y1: marginTop, y2: plotBottom },
    },
    yTicks: rows.map((row) => ({
      y: row.centerY,
      x1: marginLeft - Y_TICK_LENGTH,
      x2: marginLeft,
    })),
    ...heatmapXAxis(valueRows.columns.length, marginLeft, cellWidth, plotWidth, plotBottom),
    plotWidth,
    cellWidth,
    height: plotBottom + AXIS_HEIGHT,
  };
}
