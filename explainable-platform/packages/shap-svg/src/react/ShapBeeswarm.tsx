import { MouseEvent as ReactMouseEvent, useMemo, useState } from "react";
import { beeswarmLayout, beeswarmRows } from "../core/beeswarmLayout";
import { sampleColormap } from "../core/colormap";
import { formatValue } from "../core/format";
import { parseExplanation } from "../core/parse";
import { DEFAULT_FIDELITY, Fidelity, presentationFor } from "../core/fidelity";
import { applyFidelity } from "../core/applyFidelity";
import { prevalence } from "../core/taxonomy";

import { Explanation } from "../core/types";

export type ShapBeeswarmProps = {
  explanation: Explanation;
  maxDisplay?: number;
  faithfulOtherRow?: boolean;
  /** How closely to reproduce SHAP. See core/fidelity.ts. */
  fidelity?: Fidelity;
  classIndex?: number;
  width?: number;
  rowHeight?: number;
  seed?: number;
  dotRadius?: number;
  onFeatureClick?: (featureIndex: number | null) => void;
};

type HoveredPoint = { rowIndex: number; pointIndex: number };

export function ShapBeeswarm({
  explanation,
  maxDisplay = 10,
  faithfulOtherRow,
  fidelity = DEFAULT_FIDELITY,
  classIndex = 1,
  width = 720,
  rowHeight = 28,
  seed = 0,
  dotRadius = 3,
  onFeatureClick,
}: ShapBeeswarmProps) {
  const [hovered, setHovered] = useState<HoveredPoint | null>(null);
  const marginTop = 8;

  // A table lookup, not work: it needs no memo, and keeping it out of one
  // means the render can read it without the memo having to hand it back.
  const { units, taxonomicNames, numericLegend, abundanceScale } =
    presentationFor(fidelity);

  const layout = useMemo(() => {
    const resolved = presentationFor(fidelity);
    const parsed = applyFidelity(
      parseExplanation(explanation, { classIndex }),
      resolved,
    );
    const otherRow = faithfulOtherRow ?? resolved.faithfulOtherRow;
    const rows = beeswarmRows(
      parsed, maxDisplay, otherRow, seed, resolved.abundanceScale,
    );
    return beeswarmLayout(rows, {
      width,
      rowHeight,
      marginLeft: 260,
      marginRight: 90,
      marginTop,
      dotRadius,
    });
  }, [
    explanation,
    maxDisplay,
    faithfulOtherRow,
    fidelity,
    classIndex,
    width,
    rowHeight,
    seed,
    dotRadius,
  ]);

  const handlePointHover = (rowIndex: number, event: ReactMouseEvent<SVGGElement>) => {
    const attribute = (event.target as Element).getAttribute?.("data-point-index");
    if (attribute === null || attribute === undefined) return;
    const pointIndex = Number(attribute);
    if (Number.isInteger(pointIndex)) setHovered({ rowIndex, pointIndex });
  };

  const fallbackRow = layout.rows[0];
  const activeRow = hovered ? layout.rows[hovered.rowIndex] : fallbackRow;
  const activePoint = hovered
    ? activeRow?.points[hovered.pointIndex]
    : activeRow?.points[0];
  const legendSteps = 32;

  return (
    <svg width={width} height={layout.height} role="img" aria-label="Global SHAP beeswarm">
      <line
        x1={layout.xZero}
        x2={layout.xZero}
        y1={marginTop}
        y2={layout.plotBottom}
        stroke="#777777"
        strokeWidth={1}
      />

      {layout.rows.map((row, rowIndex) => (
        <g
          key={`row-${rowIndex}`}
          onMouseOver={(event) => handlePointHover(rowIndex, event)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => onFeatureClick?.(row.featureIndex)}
          style={{ cursor: onFeatureClick ? "pointer" : "default" }}
        >
          <rect
            x={0}
            y={row.centerY - rowHeight / 2}
            width={width}
            height={rowHeight}
            fill={hovered?.rowIndex === rowIndex ? "#00000008" : "transparent"}
          />
          <text
            x={250}
            y={row.centerY}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={13}
            fill="#333333"
            fontStyle={!row.isOtherRow && taxonomicNames ? "italic" : "normal"}
          >
            {row.label}
          </text>
          {row.points.map((point, pointIndex) => (
            <circle
              key={`point-${point.sampleIndex}`}
              data-point-index={pointIndex}
              cx={point.x}
              cy={point.y}
              r={point.radius}
              fill={point.color}
              fillOpacity={0.7}
            />
          ))}
        </g>
      ))}

      {activeRow && (
        <g aria-label="Feature value colour scale">
          {Array.from({ length: legendSteps }, (_, index) => (
            <rect
              key={`legend-${index}`}
              x={width - 160 + index * 4}
              y={layout.height - 22}
              width={4}
              height={7}
              fill={sampleColormap("red_blue", index / (legendSteps - 1))}
            />
          ))}
          {/* Spec V4. SHAP labels the scale only "Low" and "High", which cannot
              be read off — the reader has no idea whether "High" is 0.3% or 30%.
              Faithful mode keeps it; above it the ends carry their values, and
              on a ranked scale they carry the rank, since that is what the
              colour then means. */}
          <text x={width - 160} y={layout.height - 3} fontSize={10} fill="#555555">
            {!numericLegend
              ? "Low"
              : abundanceScale === "percentile"
                ? "Least"
                : formatValue(activeRow.vmin, units)}
          </text>
          <text
            x={width - 32}
            y={layout.height - 3}
            textAnchor="end"
            fontSize={10}
            fill="#555555"
          >
            {!numericLegend
              ? "High"
              : abundanceScale === "percentile"
                ? "Most"
                : formatValue(activeRow.vmax, units)}
          </text>
        </g>
      )}

      {activeRow && activePoint && (
        <g
          opacity={hovered ? 1 : 0}
          pointerEvents="none"
          transform={`translate(${activePoint.x + 8} ${activePoint.y - 8})`}
        >
          <rect x={0} y={-16} width={210} height={54} rx={3} fill="#ffffff" stroke="#cccccc" />
          <text x={7} y={0} fontSize={11} fill="#222222">{activeRow.label}</text>
          <text x={7} y={15} fontSize={11} fill="#222222">
            {`SHAP value: ${formatValue(activePoint.valueX, units)}`}
          </text>
          <text x={7} y={30} fontSize={11} fill="#222222">
            {`Feature value: ${Number.isFinite(activePoint.featureValue)
              ? formatValue(activePoint.featureValue, units)
              : "missing"}`}
          </text>
        </g>
      )}
    </svg>
  );
}
