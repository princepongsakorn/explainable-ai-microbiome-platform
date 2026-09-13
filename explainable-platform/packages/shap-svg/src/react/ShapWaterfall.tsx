import { useMemo, useState } from "react";
import { Explanation } from "../core/types";
import { parseExplanation } from "../core/parse";
import { ValuePrecision } from "../core/format";
import {
  WATERFALL_BASE_LABEL_DY,
  WATERFALL_TICK_LABEL_DY,
  waterfallLayout,
  waterfallRows,
} from "../core/waterfallLayout";

export type ShapWaterfallProps = {
  explanation: Explanation;
  sampleIndex?: number;
  maxDisplay?: number;
  faithfulOtherRow?: boolean;
  classIndex?: number;
  width?: number;
  rowHeight?: number;
  /** Decimal places for the bar labels. Display only — it changes no geometry but the text width. */
  decimals?: ValuePrecision;
  onFeatureClick?: (featureIndex: number | null) => void;
};

export function ShapWaterfall({
  explanation,
  sampleIndex = 0,
  maxDisplay = 10,
  faithfulOtherRow = false,
  classIndex = 1,
  width = 720,
  rowHeight = 30,
  decimals = 2,
  onFeatureClick,
}: ShapWaterfallProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const marginTop = 34;

  const layout = useMemo(() => {
    const parsed = parseExplanation(explanation, { classIndex });
    const rows = waterfallRows(parsed, sampleIndex, maxDisplay, faithfulOtherRow);
    return waterfallLayout(rows, {
      width,
      rowHeight,
      marginLeft: 260,
      marginRight: 110,
      marginTop,
      decimals,
    });
  }, [
    explanation, sampleIndex, maxDisplay, faithfulOtherRow,
    classIndex, width, rowHeight, decimals,
  ]);

  return (
    <svg
      width={width}
      height={layout.height}
      role="img"
      aria-label={`Local SHAP waterfall for Sample ${sampleIndex}`}
    >
      {layout.separators.map((separator, index) => (
        <line
          key={`separator-${index}`}
          x1={separator.x1}
          x2={separator.x2}
          y1={separator.y}
          y2={separator.y}
          stroke="#cccccc"
          strokeWidth={1}
          strokeDasharray="1 5"
        />
      ))}

      <g aria-hidden="true">
        <line
          x1={layout.plotLeft}
          x2={layout.plotRight}
          y1={layout.plotBottom}
          y2={layout.plotBottom}
          stroke="#333333"
          strokeWidth={1}
        />
        {layout.xTicks.map((tick) => (
          <g key={`tick-${tick.value}`}>
            <line
              x1={tick.x}
              x2={tick.x}
              y1={layout.plotBottom}
              y2={layout.plotBottom + 5}
              stroke="#333333"
              strokeWidth={1}
            />
            <text
              x={tick.x}
              y={layout.plotBottom + WATERFALL_TICK_LABEL_DY}
              textAnchor="middle"
              fontSize={11}
              fill="#333333"
            >
              {tick.label}
            </text>
          </g>
        ))}
      </g>

      {layout.connectors.map((connector, index) => (
        <line
          key={`connector-${index}`}
          x1={connector.x}
          x2={connector.x}
          y1={connector.y1}
          y2={connector.y2}
          stroke="#bbbbbb"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
      ))}

      {layout.axisMarks.map((mark) => (
        <g key={mark.kind}>
          <line
            x1={mark.x}
            x2={mark.x}
            y1={mark.y1}
            y2={mark.y2}
            stroke="#bbbbbb"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text
            x={mark.x}
            y={
              mark.kind === "output"
                ? marginTop - 10
                : layout.plotBottom + WATERFALL_BASE_LABEL_DY
            }
            textAnchor="middle"
            fontSize={12}
            fill="#777777"
          >
            {mark.label}
          </text>
        </g>
      ))}

      {layout.arrows.map((arrow, index) => (
        <g
          key={`row-${index}`}
          onMouseEnter={() => setHovered(index)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => onFeatureClick?.(arrow.featureIndex)}
          style={{ cursor: onFeatureClick ? "pointer" : "default" }}
        >
          <rect
            x={0}
            y={arrow.centerY - rowHeight / 2}
            width={width}
            height={rowHeight}
            fill={hovered === index ? "#00000008" : "transparent"}
          />
          <text
            x={250}
            y={arrow.centerY}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={13}
            fill="#333333"
            fontStyle={arrow.isOtherRow ? "normal" : "italic"}
          >
            {arrow.label}
          </text>
          <polygon
            points={arrow.points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill={arrow.color}
            stroke="rgba(255,255,255,0.8)"
            strokeWidth={1}
          />
          <text
            x={arrow.valueLabel.x}
            y={arrow.centerY}
            textAnchor={arrow.valueLabel.anchor}
            dominantBaseline="middle"
            fontSize={12}
            fill={arrow.valueLabel.inside ? "#ffffff" : arrow.color}
          >
            {arrow.valueLabel.text}
          </text>
        </g>
      ))}
    </svg>
  );
}
