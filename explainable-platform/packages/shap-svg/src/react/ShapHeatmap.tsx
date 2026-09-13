import { useMemo, useState } from "react";
import { formatValue } from "../core/format";
import { heatmapLayout, heatmapRows } from "../core/heatmapLayout";
import { parseExplanation } from "../core/parse";
import { DEFAULT_FIDELITY, Fidelity, presentationFor } from "../core/fidelity";
import { applyFidelity } from "../core/applyFidelity";
import { prevalence } from "../core/taxonomy";

import { Explanation } from "../core/types";

export type ShapHeatmapProps = {
  explanation: Explanation;
  maxDisplay?: number;
  faithfulOtherRow?: boolean;
  /** How closely to reproduce SHAP. See core/fidelity.ts. */
  fidelity?: Fidelity;
  classIndex?: number;
  width?: number;
  rowHeight?: number;
  onFeatureClick?: (featureIndex: number | null) => void;
  onSampleClick?: (sampleId: string) => void;
};

export function ShapHeatmap({
  explanation,
  maxDisplay = 10,
  faithfulOtherRow,
  fidelity = DEFAULT_FIDELITY,
  classIndex = 1,
  width = 720,
  rowHeight = 26,
  onFeatureClick,
  onSampleClick,
}: ShapHeatmapProps) {
  const [hoveredColumn, setHoveredColumn] = useState<number | null>(null);
  const marginTop = 72;

  // A table lookup, not work: it needs no memo, and keeping it out of one
  // means the render can read it without the memo having to hand it back.
  const { units, taxonomicNames } = presentationFor(fidelity);

  const layout = useMemo(() => {
    const resolved = presentationFor(fidelity);
    const parsed = applyFidelity(
      parseExplanation(explanation, { classIndex }),
      resolved,
    );
    const otherRow = faithfulOtherRow ?? resolved.faithfulOtherRow;
    const rows = heatmapRows(parsed, maxDisplay, otherRow);
    return heatmapLayout(rows, {
      width,
      rowHeight,
      marginLeft: 260,
      marginRight: 100,
      marginTop,
    });
  }, [explanation, maxDisplay, faithfulOtherRow, fidelity, classIndex, width, rowHeight]);

  const activeColumn = hoveredColumn === null ? undefined : layout.columns[hoveredColumn];
  const tooltipX = activeColumn
    ? Math.min(activeColumn.centerX + 8, width - 198)
    : 0;

  return (
    <svg width={width} height={layout.height} role="img" aria-label="Global SHAP heatmap">
      {layout.fxAxisMarks.map((mark) => (
        <g key={`fx-axis-${mark.value}`}>
          <line
            x1={layout.gridLeft - 4}
            x2={layout.gridRight}
            y1={mark.y}
            y2={mark.y}
            stroke="#dddddd"
            strokeWidth={1}
          />
          <text
            x={layout.gridLeft - 8}
            y={mark.y}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={10}
            fill="#666666"
          >
            {mark.label}
          </text>
        </g>
      ))}

      <polyline
        points={layout.fxLine.map((point) => `${point.x},${point.y}`).join(" ")}
        fill="none"
        stroke="#333333"
        strokeWidth={1.5}
      />
      <line
        x1={layout.gridLeft}
        x2={layout.gridRight}
        y1={layout.separatorY}
        y2={layout.separatorY}
        stroke="#888888"
        strokeWidth={1}
        strokeDasharray="4 4"
      />

      {layout.rows.map((row, rowIndex) => (
        <g
          key={`row-${rowIndex}`}
          onClick={() => onFeatureClick?.(row.featureIndex)}
          style={{ cursor: onFeatureClick ? "pointer" : "default" }}
        >
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
          {row.cells.map((cell, columnIndex) => (
            <rect
              key={`cell-${columnIndex}`}
              x={cell.x}
              y={cell.y}
              width={cell.width}
              height={cell.height}
              fill={cell.color}
            />
          ))}
          <rect
            x={row.sideBar.x}
            y={row.sideBar.y}
            width={row.sideBar.width}
            height={row.sideBar.height}
            fill="#777777"
          />
        </g>
      ))}

      {activeColumn && (
        <rect
          x={activeColumn.x}
          y={8}
          width={activeColumn.width}
          height={layout.plotBottom - 8}
          fill="#000000"
          fillOpacity={0.1}
          pointerEvents="none"
        />
      )}

      {layout.columns.map((column, columnIndex) => (
        <rect
          key={`column-hit-${column.sampleIndex}`}
          x={column.x}
          y={8}
          width={column.width}
          height={layout.plotBottom - 8}
          fill="transparent"
          aria-label={column.sampleId
            ? `Sample ${column.sampleId}, total SHAP value ${formatValue(column.total, units)}`
            : `Sample ${column.sampleIndex + 1}, total SHAP value ${formatValue(column.total, units)}`}
          onMouseEnter={() => setHoveredColumn(columnIndex)}
          onMouseLeave={() => setHoveredColumn(null)}
          onClick={() => {
            if (column.sampleId !== undefined) onSampleClick?.(column.sampleId);
          }}
          style={{ cursor: column.sampleId && onSampleClick ? "pointer" : "default" }}
        />
      ))}

      {activeColumn && (
        <g pointerEvents="none" transform={`translate(${tooltipX} 10)`}>
          <rect x={0} y={0} width={190} height={42} rx={3} fill="#ffffff" stroke="#cccccc" />
          <text x={7} y={15} fontSize={11} fill="#222222">
            {activeColumn.sampleId ?? `Sample ${activeColumn.sampleIndex + 1}`}
          </text>
          <text x={7} y={31} fontSize={11} fill="#222222">
            {`Σφ: ${formatValue(activeColumn.total, units)}`}
          </text>
        </g>
      )}
    </svg>
  );
}
