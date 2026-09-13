import { NEGATIVE_COLOR, POSITIVE_COLOR } from "./barLayout";
import { formatFeatureLabel, formatShapValue } from "./format";
import { orderFeatures } from "./order";
import { ParsedExplanation } from "./types";

/** Fixed on-screen arrowhead length; matplotlib's equivalent is 0.08 inches. */
export const WATERFALL_HEAD_LENGTH_PX = 8;
const BAR_THICKNESS_RATIO = 0.8;
const AXIS_HEIGHT = 34;

export type WaterfallRow = {
  label: string;
  featureIndex: number | null;
  isOtherRow: boolean;
  /** The full, unrounded SHAP contribution represented by this row. */
  value: number;
  /** Start of the arrow in value space while walking backward from f(x). */
  left: number;
  /** Signed full arrow width in value space. */
  width: number;
  /** matplotlib-compatible row number, counted upward from the bottom. */
  row: number;
  color: string;
};

export type WaterfallRows = {
  /** Rows are ordered top-to-bottom. */
  rows: WaterfallRow[];
  baseValue: number;
  modelOutput: number;
  collapsedCount: number;
};

export type WaterfallLayoutOptions = {
  width: number;
  rowHeight: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
};

export type Point = { x: number; y: number };

/** Where a bar's numeric label goes, and roughly how wide it is. */
export type WaterfallValueLabel = {
  x: number;
  anchor: "start" | "end";
  /** Estimated from the glyph count — enough to decide whether it fits. */
  estimatedWidth: number;
};

export type WaterfallArrowGeometry = WaterfallRow & {
  points: Point[];
  startX: number;
  endX: number;
  y: number;
  centerY: number;
  height: number;
  headLength: number;
  valueLabel: WaterfallValueLabel;
};

export type WaterfallAxisMark = {
  kind: "base" | "output";
  value: number;
  x: number;
  label: string;
};

export type WaterfallSeparator = {
  y: number;
  x1: number;
  x2: number;
};

export type WaterfallLayout = {
  arrows: WaterfallArrowGeometry[];
  axisMarks: WaterfallAxisMark[];
  separators: WaterfallSeparator[];
  xDomain: [number, number];
  plotWidth: number;
  plotBottom: number;
  height: number;
};

const colorFor = (value: number) => value < 0 ? NEGATIVE_COLOR : POSITIVE_COLOR;

/** Gap between a bar's tip and its number. */
const VALUE_LABEL_GAP = 6;
const VALUE_LABEL_FONT_SIZE = 12;
/** Mean glyph width as a fraction of font size, for this digit-heavy text. */
const GLYPH_WIDTH_RATIO = 0.6;

/**
 * Place a bar's numeric label.
 *
 * Preferred position is just past the tip, on the side the bar points to. For a
 * negative bar that is leftward — and a short negative bar sits close to the
 * feature names, so the label lands on top of them. When that would happen the
 * label flips to the inner side of the bar, where the plot area always has room.
 * matplotlib has the same conflict and resolves it with a wide left margin;
 * flipping is the better answer when the margin is a fixed gutter.
 */
function placeValueLabel(
  value: number,
  endX: number,
  gutterX: number,
): WaterfallValueLabel {
  const estimatedWidth =
    formatShapValue(value).length * VALUE_LABEL_FONT_SIZE * GLYPH_WIDTH_RATIO;

  if (value >= 0) {
    return { x: endX + VALUE_LABEL_GAP, anchor: "start", estimatedWidth };
  }

  const outsideLeftEdge = endX - VALUE_LABEL_GAP - estimatedWidth;
  if (outsideLeftEdge >= gutterX) {
    return { x: endX - VALUE_LABEL_GAP, anchor: "end", estimatedWidth };
  }
  return { x: endX + VALUE_LABEL_GAP, anchor: "start", estimatedWidth };
}

/**
 * The value-space part of shap/plots/_waterfall.py::waterfall_legacy.
 * It walks backward from f(x), leaving pixel scaling and arrowheads to waterfallLayout.
 */
export function waterfallRows(
  explanation: ParsedExplanation,
  sampleIndex: number,
  maxDisplay: number,
  faithfulOtherRow: boolean,
): WaterfallRows {
  if (!Number.isInteger(sampleIndex) || sampleIndex < 0 || sampleIndex >= explanation.nSamples) {
    throw new RangeError(
      `sampleIndex must identify a Sample from 0 to ${explanation.nSamples - 1}, received ${sampleIndex}`,
    );
  }
  if (!Number.isInteger(maxDisplay) || maxDisplay <= 0) {
    throw new RangeError(`maxDisplay must be a positive integer, received ${maxDisplay}`);
  }

  const values = explanation.values[sampleIndex];
  const baseValue = explanation.baseValues[sampleIndex];
  const modelOutput = baseValue + values.reduce((sum, value) => sum + value, 0);
  const order = orderFeatures(values.map(Math.abs));
  const visibleLimit = Math.min(maxDisplay, explanation.nFeatures);
  const hasOtherRow = visibleLimit < explanation.nFeatures;
  const realCount = hasOtherRow && faithfulOtherRow ? visibleLimit - 1 : visibleLimit;
  const rowCount = realCount + (hasOtherRow ? 1 : 0);

  let location = modelOutput;
  const rows: WaterfallRow[] = [];
  for (let rank = 0; rank < realCount; rank++) {
    const featureIndex = order[rank];
    const value = values[featureIndex];
    location -= value;
    rows.push({
      label: formatFeatureLabel(explanation.featureNames[featureIndex]),
      featureIndex,
      isOtherRow: false,
      value,
      left: location,
      width: value,
      row: rowCount - 1 - rank,
      color: colorFor(value),
    });
  }

  const collapsed = order.slice(realCount);
  if (hasOtherRow) {
    const value = collapsed.reduce((sum, featureIndex) => sum + values[featureIndex], 0);
    rows.push({
      label: `${collapsed.length} other features`,
      featureIndex: null,
      isOtherRow: true,
      value,
      left: baseValue,
      width: value,
      row: 0,
      color: colorFor(value),
    });
  }

  return {
    rows,
    baseValue,
    modelOutput,
    collapsedCount: hasOtherRow ? collapsed.length : 0,
  };
}

export function waterfallLayout(
  valueRows: WaterfallRows,
  opts: WaterfallLayoutOptions,
): WaterfallLayout {
  const { width, rowHeight, marginLeft, marginRight, marginTop } = opts;
  const plotWidth = width - marginLeft - marginRight;
  const coordinates = [valueRows.baseValue, valueRows.modelOutput];
  for (const row of valueRows.rows) coordinates.push(row.left, row.left + row.width);
  const min = Math.min(...coordinates);
  const max = Math.max(...coordinates);
  const span = max - min || 1;
  const toX = (value: number) => marginLeft + ((value - min) / span) * plotWidth;

  const barHeight = rowHeight * BAR_THICKNESS_RATIO;
  const inset = (rowHeight - barHeight) / 2;
  const arrows = valueRows.rows.map((row, index): WaterfallArrowGeometry => {
    const y = marginTop + index * rowHeight + inset;
    const centerY = marginTop + index * rowHeight + rowHeight / 2;
    const startX = toX(row.left);
    const endX = toX(row.left + row.width);
    const headLength = Math.min(Math.abs(endX - startX), WATERFALL_HEAD_LENGTH_PX);
    const neckX = row.width < 0 ? endX + headLength : endX - headLength;
    const points = [
      { x: startX, y },
      { x: neckX, y },
      { x: endX, y: centerY },
      { x: neckX, y: y + barHeight },
      { x: startX, y: y + barHeight },
    ];
    return {
      ...row,
      points,
      startX,
      endX,
      y,
      centerY,
      height: barHeight,
      headLength,
      valueLabel: placeValueLabel(row.value, endX, marginLeft),
    };
  });

  const plotBottom = marginTop + valueRows.rows.length * rowHeight;
  return {
    arrows,
    axisMarks: [
      {
        kind: "base",
        value: valueRows.baseValue,
        x: toX(valueRows.baseValue),
        label: `E[f(X)] = ${formatShapValue(valueRows.baseValue)}`,
      },
      {
        kind: "output",
        value: valueRows.modelOutput,
        x: toX(valueRows.modelOutput),
        label: `f(x) = ${formatShapValue(valueRows.modelOutput)}`,
      },
    ],
    separators: valueRows.rows.map((_, index) => ({
      y: marginTop + index * rowHeight + rowHeight / 2,
      x1: marginLeft,
      x2: marginLeft + plotWidth,
    })),
    xDomain: [min, max],
    plotWidth,
    plotBottom,
    height: plotBottom + AXIS_HEIGHT,
  };
}
