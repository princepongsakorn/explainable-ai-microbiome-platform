import { useMemo, useState } from "react";
import { formatShapValue } from "../core/format";
import { XAxis } from "./XAxis";
import { heatmapLayout, heatmapRows } from "../core/heatmapLayout";
import { parseExplanation } from "../core/parse";
import { groupExplanationByGenus } from "../core/taxonomy";
import { RowSort } from "../core/rowSort";
import { Explanation } from "../core/types";

export type ShapHeatmapProps = {
  explanation: Explanation;
  maxDisplay?: number;
  faithfulOtherRow?: boolean;
  /** Collapse `Genus_species` Features into their genus before drawing. */
  groupByGenus?: boolean;
  /** Order of the displayed rows. Never changes which rows are shown. */
  rowSort?: RowSort;
  classIndex?: number;
  width?: number;
  rowHeight?: number;
  onFeatureClick?: (featureIndex: number | null) => void;
  onSampleClick?: (sampleId: string) => void;
};

export function ShapHeatmap({
  explanation,
  maxDisplay = 10,
  faithfulOtherRow = false,
  groupByGenus = false,
  rowSort = "importance",
  classIndex = 1,
  width = 720,
  rowHeight = 26,
  onFeatureClick,
  onSampleClick,
}: ShapHeatmapProps) {
  const [hoveredColumn, setHoveredColumn] = useState<number | null>(null);
  const marginTop = 72;

  const layout = useMemo(() => {
    const raw = parseExplanation(explanation, { classIndex });
    const parsed = groupByGenus ? groupExplanationByGenus(raw) : raw;
    const rows = heatmapRows(parsed, maxDisplay, faithfulOtherRow, rowSort);
    return heatmapLayout(rows, {
      width,
      rowHeight,
      marginLeft: 260,
      marginRight: 100,
      marginTop,
    });
  }, [groupByGenus, rowSort, explanation, maxDisplay, faithfulOtherRow, classIndex, width, rowHeight]);

  const activeColumn = hoveredColumn === null ? undefined : layout.columns[hoveredColumn];

  // What a person reads for a column. sampleId is the record UUID — the key
  // onSampleClick hands back — and is never shown: an old payload without
  // labels reads "Sample n" rather than a UUID.
  const nameOf = (column: { sampleIndex: number; sampleLabel?: string }) => {
    if (!column.sampleLabel) return `Sample ${column.sampleIndex + 1}`;
    return layout.sampleLabelColumn
      ? `${layout.sampleLabelColumn}: ${column.sampleLabel}`
      : column.sampleLabel;
  };
  // Real ids ("subject_id: CCIS02856720ST-4-0") run past a fixed box.
  const tooltipWidth = activeColumn
    ? Math.max(190, nameOf(activeColumn).length * 6.5 + 16)
    : 190;
  const tooltipX = activeColumn
    ? Math.max(0, Math.min(activeColumn.centerX + 8, width - tooltipWidth - 8))
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

      <XAxis
        ticks={layout.xTicks}
        spine={layout.xSpine}
        title={layout.xTitle}
        plotBottom={layout.plotBottom}
        tickFontSize={10}
      />

      <g aria-hidden="true">
        {[layout.spines.left, layout.spines.right].map((spine, index) => (
          <line
            key={`spine-${index}`}
            x1={spine.x}
            x2={spine.x}
            y1={spine.y1}
            y2={spine.y2}
            stroke="#333333"
            strokeWidth={1}
          />
        ))}
        {layout.yTicks.map((tick, index) => (
          <line
            key={`ytick-${index}`}
            x1={tick.x1}
            x2={tick.x2}
            y1={tick.y}
            y2={tick.y}
            stroke="#333333"
            strokeWidth={1}
          />
        ))}
      </g>

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
            fontStyle={row.isOtherRow ? "normal" : "italic"}
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
          aria-label={`${nameOf(column)}, total SHAP value ${formatShapValue(column.total)}`}
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
          <rect x={0} y={0} width={tooltipWidth} height={42} rx={3} fill="#ffffff" stroke="#cccccc" />
          <text x={7} y={15} fontSize={11} fill="#222222">
            {nameOf(activeColumn)}
          </text>
          <text x={7} y={31} fontSize={11} fill="#222222">
            {`Σφ: ${formatShapValue(activeColumn.total)}`}
          </text>
        </g>
      )}
    </svg>
  );
}
