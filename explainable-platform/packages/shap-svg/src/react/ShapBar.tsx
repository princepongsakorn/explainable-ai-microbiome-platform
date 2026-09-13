import { useMemo, useState } from "react";
import { Explanation } from "../core/types";
import { parseExplanation } from "../core/parse";
import { DEFAULT_FIDELITY, Fidelity, presentationFor } from "../core/fidelity";
import { applyFidelity } from "../core/applyFidelity";
import { prevalence } from "../core/taxonomy";

import { globalImportance, orderFeatures } from "../core/order";
import { collapseToDisplay } from "../core/collapse";
import { barLayout } from "../core/barLayout";
import { formatValue } from "../core/format";

export type ShapBarProps = {
  explanation: Explanation;
  maxDisplay?: number;
  faithfulOtherRow?: boolean;
  /** How closely to reproduce SHAP. See core/fidelity.ts. */
  fidelity?: Fidelity;
  classIndex?: number;
  width?: number;
  rowHeight?: number;
  onFeatureClick?: (featureIndex: number | null) => void;
};

export function ShapBar({
  explanation,
  maxDisplay = 10,
  faithfulOtherRow,
  fidelity = DEFAULT_FIDELITY,
  classIndex = 1,
  width = 720,
  rowHeight = 26,
  onFeatureClick,
}: ShapBarProps) {
  const [hovered, setHovered] = useState<number | null>(null);

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
    const importance = globalImportance(parsed);
    const order = orderFeatures(importance);
    const rows = collapseToDisplay(
      parsed.featureNames, importance, order, maxDisplay, otherRow,
    );
    return barLayout(rows, {
      width, rowHeight, marginLeft: 260, marginRight: 90, marginTop: 8,
      zeroHandling: resolved.zeroHandling,
    });
  }, [explanation, maxDisplay, faithfulOtherRow, fidelity, classIndex, width, rowHeight]);

  return (
    <svg width={width} height={layout.height} role="img"
         aria-label="Mean absolute SHAP value per feature">
      {layout.showZeroRule && (
        <line x1={layout.xZero} x2={layout.xZero} y1={0} y2={layout.height - 30}
              stroke="#000000" strokeWidth={1} />
      )}
      {layout.bars.map((bar, i) => (
        <g key={`row-${i}`}
           onMouseEnter={() => setHovered(i)}
           onMouseLeave={() => setHovered(null)}
           onClick={() => onFeatureClick?.(bar.featureIndex)}
           style={{ cursor: onFeatureClick ? "pointer" : "default" }}>
          <rect x={0} y={bar.y - (rowHeight - bar.height) / 2}
                width={width} height={rowHeight}
                fill={hovered === i ? "#00000008" : "transparent"} />
          <text x={250} y={bar.centerY} textAnchor="end" dominantBaseline="middle"
                fontSize={13} fill="#333333"
                fontStyle={!bar.isOtherRow && taxonomicNames ? "italic" : "normal"}>
            {bar.label}
          </text>
          <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height}
                fill={bar.color} stroke="rgba(255,255,255,0.8)" strokeWidth={1} />
          <text x={bar.x + bar.width + 6} y={bar.centerY} dominantBaseline="middle"
                fontSize={12} fill={bar.color}>
            {formatValue(bar.value, units)}
          </text>
        </g>
      ))}
    </svg>
  );
}
