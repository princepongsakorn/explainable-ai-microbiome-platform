import { useId, useMemo, useState } from "react";
import { Explanation } from "../core/types";
import { parseExplanation } from "../core/parse";
import { globalImportance, orderFeatures } from "../core/order";
import { collapseToDisplay } from "../core/collapse";
import { barLayout } from "../core/barLayout";
import { formatShapValue } from "../core/format";

export type ShapBarProps = {
  explanation: Explanation;
  maxDisplay?: number;
  faithfulOtherRow?: boolean;
  classIndex?: number;
  width?: number;
  rowHeight?: number;
  onFeatureClick?: (featureIndex: number | null) => void;
};

export function ShapBar({
  explanation,
  maxDisplay = 10,
  faithfulOtherRow = false,
  classIndex = 1,
  width = 720,
  rowHeight = 26,
  onFeatureClick,
}: ShapBarProps) {
  // Namespacing element ids the way shap/plots/_text.py:88 does, so several charts
  // can share a page without colliding.
  const uid = useId().replace(/:/g, "");
  const [hovered, setHovered] = useState<number | null>(null);

  const layout = useMemo(() => {
    const parsed = parseExplanation(explanation, { classIndex });
    const importance = globalImportance(parsed);
    const order = orderFeatures(importance);
    const rows = collapseToDisplay(
      parsed.featureNames, importance, order, maxDisplay, faithfulOtherRow,
    );
    return barLayout(rows, {
      width, rowHeight, marginLeft: 260, marginRight: 90, marginTop: 8,
    });
  }, [explanation, maxDisplay, faithfulOtherRow, classIndex, width, rowHeight]);

  return (
    <svg width={width} height={layout.height} role="img"
         aria-label="Mean absolute SHAP value per feature">
      {layout.showZeroRule && (
        <line x1={layout.xZero} x2={layout.xZero} y1={0} y2={layout.height - 30}
              stroke="#000000" strokeWidth={1} />
      )}
      {layout.bars.map((bar, i) => (
        <g key={`${uid}-row-${i}`}
           onMouseEnter={() => setHovered(i)}
           onMouseLeave={() => setHovered(null)}
           onClick={() => onFeatureClick?.(bar.featureIndex)}
           style={{ cursor: onFeatureClick ? "pointer" : "default" }}>
          <rect x={0} y={bar.y - (rowHeight - bar.height) / 2}
                width={width} height={rowHeight}
                fill={hovered === i ? "#00000008" : "transparent"} />
          <text x={250} y={bar.centerY} textAnchor="end" dominantBaseline="middle"
                fontSize={13} fill="#333333"
                fontStyle={bar.isOtherRow ? "normal" : "italic"}>
            {bar.label}
          </text>
          <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height}
                fill={bar.color} stroke="rgba(255,255,255,0.8)" strokeWidth={1} />
          <text x={bar.x + bar.width + 6} y={bar.centerY} dominantBaseline="middle"
                fontSize={12} fill={bar.color}>
            {formatShapValue(bar.value)}
          </text>
        </g>
      ))}
    </svg>
  );
}
