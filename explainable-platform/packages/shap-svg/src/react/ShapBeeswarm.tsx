import { MouseEvent as ReactMouseEvent, useMemo, useState } from "react";
import { beeswarmLayout, beeswarmRows } from "../core/beeswarmLayout";
import { sampleColormap } from "../core/colormap";
import { formatShapValue } from "../core/format";
import { parseExplanation } from "../core/parse";
import { Explanation } from "../core/types";

export type ShapBeeswarmProps = {
  explanation: Explanation;
  maxDisplay?: number;
  faithfulOtherRow?: boolean;
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
  faithfulOtherRow = false,
  classIndex = 1,
  width = 720,
  rowHeight = 28,
  seed = 0,
  dotRadius = 3,
  onFeatureClick,
}: ShapBeeswarmProps) {
  const [hovered, setHovered] = useState<HoveredPoint | null>(null);
  const marginTop = 8;

  const layout = useMemo(() => {
    const parsed = parseExplanation(explanation, { classIndex });
    const rows = beeswarmRows(parsed, maxDisplay, faithfulOtherRow, seed);
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
            fontStyle={row.isOtherRow ? "normal" : "italic"}
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
          <text x={width - 160} y={layout.height - 3} fontSize={10} fill="#555555">
            {formatShapValue(activeRow.vmin)}
          </text>
          <text
            x={width - 32}
            y={layout.height - 3}
            textAnchor="end"
            fontSize={10}
            fill="#555555"
          >
            {formatShapValue(activeRow.vmax)}
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
            {`SHAP value: ${formatShapValue(activePoint.valueX)}`}
          </text>
          <text x={7} y={30} fontSize={11} fill="#222222">
            {`Feature value: ${Number.isFinite(activePoint.featureValue)
              ? formatShapValue(activePoint.featureValue)
              : "missing"}`}
          </text>
        </g>
      )}
    </svg>
  );
}
