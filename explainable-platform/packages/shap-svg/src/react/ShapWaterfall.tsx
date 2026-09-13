import { useMemo, useState } from "react";
import { Explanation } from "../core/types";
import { parseExplanation } from "../core/parse";
import { DEFAULT_FIDELITY, Fidelity, presentationFor } from "../core/fidelity";
import { applyFidelity } from "../core/applyFidelity";
import { prevalence } from "../core/taxonomy";

import { ValuePrecision } from "../core/format";
import { waterfallLayout, waterfallRows } from "../core/waterfallLayout";

export type ShapWaterfallProps = {
  explanation: Explanation;
  sampleIndex?: number;
  maxDisplay?: number;
  faithfulOtherRow?: boolean;
  /** How closely to reproduce SHAP. See core/fidelity.ts. */
  fidelity?: Fidelity;
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
  faithfulOtherRow,
  fidelity = DEFAULT_FIDELITY,
  classIndex = 1,
  width = 720,
  rowHeight = 30,
  decimals = 2,
  onFeatureClick,
}: ShapWaterfallProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const marginTop = 34;

  const { layout, presentation, prevalences } = useMemo(() => {
    const resolved = presentationFor(fidelity);
    const parsed = applyFidelity(
      parseExplanation(explanation, { classIndex }),
      resolved,
    );
    const otherRow = faithfulOtherRow ?? resolved.faithfulOtherRow;
    const rows = waterfallRows(
      parsed, sampleIndex, maxDisplay, otherRow, resolved.zeroHandling,
    );
    return {
      presentation: resolved,
      // Prevalence is a property of the cohort, not of this Sample, so it is
      // computed over the whole matrix and only when a level asks for it.
      prevalences: resolved.showPrevalence ? prevalence(parsed.data) : undefined,
      layout: waterfallLayout(rows, {
        width,
        rowHeight,
        marginLeft: 260,
        marginRight: 110,
        marginTop,
        decimals,
        units: resolved.units,
      }),
    };
  }, [
    explanation, sampleIndex, maxDisplay, faithfulOtherRow, fidelity,
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

      {layout.axisMarks.map((mark) => (
        <g key={mark.kind}>
          <line
            x1={mark.x}
            x2={mark.x}
            y1={marginTop}
            y2={layout.plotBottom}
            stroke="#bbbbbb"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text
            x={mark.x}
            y={mark.kind === "output" ? marginTop - 10 : layout.plotBottom + 20}
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
          {prevalences && arrow.featureIndex !== null && (
            <title>
              {`${arrow.label} — present in ${Math.round(
                prevalences[arrow.featureIndex] * 100,
              )}% of samples`}
            </title>
          )}
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
            fontStyle={
              !arrow.isOtherRow && presentation.taxonomicNames ? "italic" : "normal"
            }
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
