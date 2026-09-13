import {
  AxisSpine,
  AxisTick,
  AxisTitle,
  TICK_LABEL_DY,
  TICK_LENGTH,
} from "../core/ticks";

/**
 * The bottom axis the summary charts share: optional spine, outward ticks with
 * labels, and a centred title. The layouts decide every position; this only
 * draws them, so the three charts cannot drift apart in how an axis looks.
 */
export function XAxis({
  ticks,
  spine,
  title,
  plotBottom,
  tickFontSize = 11,
}: {
  ticks: AxisTick[];
  spine: AxisSpine | null;
  title: AxisTitle;
  plotBottom: number;
  /** SHAP's tick label size for the chart, in the same units as the text. */
  tickFontSize?: number;
}) {
  return (
    <g aria-hidden="true">
      {spine && (
        <line
          x1={spine.x1}
          x2={spine.x2}
          y1={spine.y}
          y2={spine.y}
          stroke="#333333"
          strokeWidth={1}
        />
      )}
      {ticks.map((tick) => (
        <g key={`xtick-${tick.value}`}>
          <line
            x1={tick.x}
            x2={tick.x}
            y1={plotBottom}
            y2={plotBottom + TICK_LENGTH}
            stroke="#333333"
            strokeWidth={1}
          />
          <text
            x={tick.x}
            y={plotBottom + TICK_LABEL_DY}
            textAnchor="middle"
            fontSize={tickFontSize}
            fill="#333333"
          >
            {tick.label}
          </text>
        </g>
      ))}
      <text
        x={title.x}
        y={title.y}
        textAnchor="middle"
        fontSize={title.fontSize}
        fill="#333333"
      >
        {title.text}
      </text>
    </g>
  );
}
