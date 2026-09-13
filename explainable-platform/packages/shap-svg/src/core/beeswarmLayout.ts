import { collapseToDisplay } from "./collapse";
import { sampleColormap } from "./colormap";
import { globalImportance, orderFeatures } from "./order";
import { ParsedExplanation } from "./types";

export const BEESWARM_MISSING_COLOR = "#777777";
export const BEESWARM_ROW_HEIGHT = 0.4;
const NBINS = 100;
const AXIS_HEIGHT = 30;

export type BeeswarmPoint = {
  sampleIndex: number;
  /** SHAP value in value space. */
  x: number;
  /** SHAP-compatible row coordinate, including signed vertical jitter. */
  y: number;
  /** Original Feature value before percentile clipping. */
  featureValue: number;
  /** Value sent through the colour map, or null when the Feature value is missing. */
  colorValue: number | null;
  color: string;
};

export type BeeswarmRow = {
  label: string;
  featureIndex: number | null;
  isOtherRow: boolean;
  /** SHAP row number, counted upward from the bottom. */
  rowIndex: number;
  vmin: number;
  vmax: number;
  points: BeeswarmPoint[];
};

export type BeeswarmRows = {
  /** Rows are ordered top-to-bottom. */
  rows: BeeswarmRow[];
  collapsedCount: number;
};

export type BeeswarmLayoutOptions = {
  width: number;
  rowHeight: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  dotRadius: number;
};

export type BeeswarmPointGeometry = Omit<BeeswarmPoint, "x" | "y"> & {
  x: number;
  y: number;
  valueX: number;
  valueY: number;
  radius: number;
};

export type BeeswarmRowGeometry = Omit<BeeswarmRow, "points"> & {
  centerY: number;
  points: BeeswarmPointGeometry[];
};

export type BeeswarmLayout = {
  rows: BeeswarmRowGeometry[];
  xDomain: [number, number];
  xZero: number;
  plotWidth: number;
  plotBottom: number;
  height: number;
};

function percentile(values: number[], percent: number): number {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return 0;
  const position = (finite.length - 1) * percent / 100;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return finite[lower] + (finite[upper] - finite[lower]) * fraction;
}

function colorDomain(featureValues: number[]): [number, number] {
  let vmin = percentile(featureValues, 5);
  let vmax = percentile(featureValues, 95);
  if (vmin === vmax) {
    vmin = percentile(featureValues, 1);
    vmax = percentile(featureValues, 99);
  }
  if (vmin === vmax) {
    const finite = featureValues.filter(Number.isFinite);
    if (finite.length > 0) {
      vmin = Math.min(...finite);
      vmax = Math.max(...finite);
    }
  }
  if (vmin > vmax) vmin = vmax;
  return [vmin, vmax];
}

/** Small deterministic PRNG used only to resolve points tied in the same x bin. */
function seededRandom(seed: number): () => number {
  let state = Math.trunc(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** JavaScript rounds .5 upward; NumPy rounds an exact .5 to the nearest even integer. */
function numpyRound(value: number): number {
  const lower = Math.floor(value);
  if (value - lower === 0.5) return lower % 2 === 0 ? lower : lower + 1;
  return Math.round(value);
}

function spreadPoints(xs: number[], rowIndex: number, seed: number): number[] {
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const quantized = xs.map((x) => numpyRound(NBINS * (x - min) / (max - min + 1e-8)));
  const random = seededRandom(seed);
  const order = quantized
    .map((bin, index) => ({ bin, index, tieBreak: random() }))
    .sort((a, b) => (a.bin - b.bin) || (a.tieBreak - b.tieBreak))
    .map((entry) => entry.index);

  const offsets = new Array<number>(xs.length).fill(0);
  let layer = 0;
  let lastBin = -1;
  for (const index of order) {
    const bin = quantized[index];
    if (bin !== lastBin) layer = 0;
    offsets[index] = Math.ceil(layer / 2) * ((layer % 2) * 2 - 1);
    layer += 1;
    lastBin = bin;
  }

  const maxPositiveOffset = Math.max(0, ...offsets);
  const scale = 0.9 * (BEESWARM_ROW_HEIGHT / (maxPositiveOffset + 1));
  return offsets.map((offset) => rowIndex + offset * scale);
}

/**
 * Computes SHAP-compatible beeswarm rows entirely in value space. Pixel scaling belongs in
 * beeswarmLayout so golden values can be compared without a viewport.
 */
export function beeswarmRows(
  explanation: ParsedExplanation,
  maxDisplay: number,
  faithfulOtherRow: boolean,
  seed = 0,
): BeeswarmRows {
  if (!Number.isInteger(maxDisplay) || maxDisplay <= 0) {
    throw new RangeError(`maxDisplay must be a positive integer, received ${maxDisplay}`);
  }
  if (!Number.isFinite(seed)) {
    throw new RangeError(`seed must be finite, received ${String(seed)}`);
  }

  const importance = globalImportance(explanation);
  const order = orderFeatures(importance);
  const display = collapseToDisplay(
    explanation.featureNames,
    importance,
    order,
    maxDisplay,
    faithfulOtherRow,
  );
  const visibleFeatures = new Set(
    display.rows.flatMap((row) => row.featureIndex === null ? [] : [row.featureIndex]),
  );
  const collapsedFeatures = order.filter((featureIndex) => !visibleFeatures.has(featureIndex));

  const rows = display.rows.map((displayRow, displayIndex): BeeswarmRow => {
    const featureIndices = displayRow.featureIndex === null
      ? collapsedFeatures
      : [displayRow.featureIndex];
    // SHAP's faithful collapse mutates only the SHAP-value matrix. Its colour values remain those
    // of the Feature at the absorbed rank. Corrected mode has a genuinely separate Other row and
    // therefore sums the hidden Feature values as specified for that mode.
    const colorFeatureIndices = displayRow.featureIndex === null && faithfulOtherRow
      ? collapsedFeatures.slice(0, 1)
      : featureIndices;
    const xs = explanation.values.map((sample) =>
      featureIndices.reduce((sum, featureIndex) => sum + sample[featureIndex], 0));
    const featureValues = explanation.data.map((sample) =>
      colorFeatureIndices.reduce((sum, featureIndex) => sum + sample[featureIndex], 0));
    const rowIndex = display.rows.length - 1 - displayIndex;
    const ys = spreadPoints(xs, rowIndex, seed + Math.imul(displayIndex + 1, 0x9e3779b1));
    const [vmin, vmax] = colorDomain(featureValues);
    const colorSpan = vmax - vmin;

    return {
      label: displayRow.label,
      featureIndex: displayRow.featureIndex,
      isOtherRow: displayRow.isOtherRow,
      rowIndex,
      vmin,
      vmax,
      points: xs.map((x, sampleIndex): BeeswarmPoint => {
        const featureValue = featureValues[sampleIndex];
        if (!Number.isFinite(featureValue)) {
          return {
            sampleIndex,
            x,
            y: ys[sampleIndex],
            featureValue,
            colorValue: null,
            color: BEESWARM_MISSING_COLOR,
          };
        }
        const colorValue = Math.max(vmin, Math.min(vmax, featureValue));
        const normalized = colorSpan === 0 ? 0 : (colorValue - vmin) / colorSpan;
        return {
          sampleIndex,
          x,
          y: ys[sampleIndex],
          featureValue,
          colorValue,
          color: sampleColormap("red_blue", normalized),
        };
      }),
    };
  });

  return { rows, collapsedCount: display.collapsedCount };
}

/** Projects beeswarm value-space rows into SVG coordinates. */
export function beeswarmLayout(
  valueRows: BeeswarmRows,
  opts: BeeswarmLayoutOptions,
): BeeswarmLayout {
  const { width, rowHeight, marginLeft, marginRight, marginTop, dotRadius } = opts;
  const plotWidth = width - marginLeft - marginRight;
  const values = valueRows.rows.flatMap((row) => row.points.map((point) => point.x));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const toX = (value: number) => marginLeft + (value - min) / span * plotWidth;
  const highestRowIndex = Math.max(0, valueRows.rows.length - 1);

  const rows = valueRows.rows.map((row): BeeswarmRowGeometry => {
    const centerY = marginTop + (highestRowIndex - row.rowIndex + 0.5) * rowHeight;
    return {
      ...row,
      centerY,
      points: row.points.map((point): BeeswarmPointGeometry => ({
        ...point,
        valueX: point.x,
        valueY: point.y,
        x: toX(point.x),
        y: centerY - (point.y - row.rowIndex) * rowHeight,
        radius: dotRadius,
      })),
    };
  });

  const plotBottom = marginTop + valueRows.rows.length * rowHeight;
  return {
    rows,
    xDomain: [min, max],
    xZero: toX(0),
    plotWidth,
    plotBottom,
    height: plotBottom + AXIS_HEIGHT,
  };
}
