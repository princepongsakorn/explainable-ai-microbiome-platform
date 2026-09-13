import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowsPointingOutIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { Explanation, ValuePrecision } from "@/packages/shap-svg";
import {
  ShapBar,
  ShapBeeswarm,
  ShapHeatmap,
  ShapWaterfall,
} from "@/packages/shap-svg/react";
import { useExplanation, sampleIndexOf } from "@/lib/useExplanation";

const MIN_DISPLAY = 5;
const MAX_DISPLAY = 50;
const DEFAULT_DISPLAY = 15;
const PRECISIONS: ValuePrecision[] = [2, 3, 4];
const DEFAULT_PRECISION: ValuePrecision = 2;

const INLINE_WIDTH = 720;
/** Room for the overlay's own padding, so the chart does not sit under its edge. */
const EXPANDED_CHROME = 96;
/** Below this, expanding is no more readable than the inline view. */
const MIN_EXPANDED_WIDTH = 900;
/** Rows get taller when expanded — reading them is the point of expanding. */
const EXPANDED_ROW_SCALE = 1.35;

/** Everything a chart needs to draw itself at the size the frame decided on. */
type ChartView = {
  explanation: Explanation;
  maxDisplay: number;
  decimals: ValuePrecision;
  width: number;
  rowHeight: number;
};

/** Viewport width, tracked only while something needs it. */
function useViewportWidth(active: boolean) {
  const [width, setWidth] = useState(1280);

  useEffect(() => {
    if (!active) return;
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [active]);

  return width;
}

/** Escape to close, and no scrolling the page behind the overlay. */
function useOverlayBehaviour(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);
}

/**
 * Shared shell: fetch state, the controls, and the expanded view.
 *
 * The controls change only what is drawn from a payload already in memory,
 * which is the point of shipping values instead of a rendered image — there is
 * no request behind any of them, expanding included.
 */
function ChartFrame({
  predictionId,
  title,
  children,
  emptyLabel,
  rowHeight,
  showPrecision = false,
}: {
  predictionId?: string;
  /** Names the chart in the expanded view. */
  title: string;
  emptyLabel: string;
  rowHeight: number;
  /** Offer the decimal-places control. Only the waterfall labels each bar. */
  showPrecision?: boolean;
  children: (view: ChartView) => ReactNode;
}) {
  const { explanation, error, loading, progress } = useExplanation(predictionId);
  const [maxDisplay, setMaxDisplay] = useState(DEFAULT_DISPLAY);
  const [decimals, setDecimals] = useState<ValuePrecision>(DEFAULT_PRECISION);
  const [expanded, setExpanded] = useState(false);
  // A portal needs a document, which the server render does not have.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useOverlayBehaviour(expanded, () => setExpanded(false));
  const viewportWidth = useViewportWidth(expanded);

  if (loading) {
    return <div className="text-sm text-gray-400 py-4">Loading explanation…</div>;
  }
  if (error || !explanation) {
    return (
      <div className="text-sm text-gray-500 py-4">
        {/* The job reports its progress over SSE, and takes about a minute for
            a few hundred Samples — long enough that "not computed yet" on its
            own reads as a failure rather than as a wait. */}
        {progress
          ? `Computing explanation… ${progress.done} / ${progress.total} samples`
          : error ?? emptyLabel}
      </div>
    );
  }

  const featureCount = explanation.feature_names.length;
  const sliderMax = Math.min(MAX_DISPLAY, featureCount);
  const shown = Math.min(maxDisplay, sliderMax);

  const controls = (
    <div className="flex items-center gap-3 text-sm text-gray-600">
      <label htmlFor={`max-display-${predictionId}`}>Features shown</label>
      <input
        id={`max-display-${predictionId}`}
        type="range"
        min={MIN_DISPLAY}
        max={sliderMax}
        value={shown}
        onChange={(event) => setMaxDisplay(Number(event.target.value))}
        className="flex-1"
      />
      <span className="tabular-nums w-16 text-right">
        {shown} / {featureCount}
      </span>
      {showPrecision && (
        <span className="flex items-center gap-1 pl-3 border-l border-gray-200">
          <span>Decimals</span>
          {PRECISIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === decimals}
              onClick={() => setDecimals(option)}
              className={`px-2 py-0.5 rounded tabular-nums ${
                option === decimals
                  ? "bg-gray-800 text-white"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              {option}
            </button>
          ))}
        </span>
      )}
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1">{controls}</div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title="Expand to full screen"
          aria-label={`Expand ${title} to full screen`}
          className="flex items-center gap-1 px-2 py-1 rounded text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 whitespace-nowrap"
        >
          <ArrowsPointingOutIcon className="w-4 h-4" />
          Expand
        </button>
      </div>

      <div className="overflow-x-auto">
        {children({
          explanation,
          maxDisplay: shown,
          decimals,
          width: INLINE_WIDTH,
          rowHeight,
        })}
      </div>

      {expanded &&
        mounted &&
        createPortal(
          // This sits inside a transformed drawer, which would otherwise become
          // the containing block for a fixed overlay and trap it there.
          // Portalling to body is what keeps "full screen" meaning full screen.
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
            onClick={() => setExpanded(false)}
          >
            <div
              className="bg-white rounded-lg shadow-xl w-full h-full flex flex-col overflow-hidden"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <div className="font-medium">{title}</div>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Close"
                  className="p-1 rounded hover:bg-gray-100"
                >
                  <XMarkIcon className="w-5 h-5 text-gray-600" />
                </button>
              </div>
              <div className="px-4 py-3 border-b border-gray-200">{controls}</div>
              <div className="flex-1 overflow-auto p-4">
                {children({
                  explanation,
                  maxDisplay: shown,
                  decimals,
                  width: Math.max(
                    MIN_EXPANDED_WIDTH,
                    viewportWidth - EXPANDED_CHROME
                  ),
                  rowHeight: Math.round(rowHeight * EXPANDED_ROW_SCALE),
                })}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/** Mean absolute SHAP value per feature, across every sample in the prediction. */
export function GlobalImportanceChart({ predictionId }: { predictionId?: string }) {
  return (
    <ChartFrame
      predictionId={predictionId}
      title="Feature importance"
      emptyLabel="No explanation available."
      rowHeight={26}
    >
      {({ explanation, maxDisplay, width, rowHeight }) => (
        <ShapBar
          explanation={explanation}
          maxDisplay={maxDisplay}
          width={width}
          rowHeight={rowHeight}
        />
      )}
    </ChartFrame>
  );
}

/** One dot per sample per feature, coloured by that sample's abundance. */
export function GlobalBeeswarmChart({ predictionId }: { predictionId?: string }) {
  return (
    <ChartFrame
      predictionId={predictionId}
      title="Beeswarm"
      emptyLabel="No explanation available."
      rowHeight={28}
    >
      {({ explanation, maxDisplay, width, rowHeight }) => (
        <ShapBeeswarm
          explanation={explanation}
          maxDisplay={maxDisplay}
          width={width}
          rowHeight={rowHeight}
        />
      )}
    </ChartFrame>
  );
}

/**
 * One cell per sample per feature, coloured by the SHAP value.
 *
 * Clicking a column hands back the sample id so the caller can open that
 * sample's breakdown — the data is already in memory, so it costs no request.
 * The original PNG labelled its x axis "Instances" and nothing more, which made
 * the substructure it exists to show impossible to read.
 */
export function GlobalHeatmapChart({
  predictionId,
  onSampleClick,
}: {
  predictionId?: string;
  onSampleClick?: (sampleId: string) => void;
}) {
  return (
    <ChartFrame
      predictionId={predictionId}
      title="Heatmap"
      emptyLabel="No explanation available."
      rowHeight={26}
    >
      {({ explanation, maxDisplay, width, rowHeight }) => (
        <ShapHeatmap
          explanation={explanation}
          maxDisplay={maxDisplay}
          width={width}
          rowHeight={rowHeight}
          onSampleClick={onSampleClick}
        />
      )}
    </ChartFrame>
  );
}

/**
 * One sample's contributions, from the model output back to the base value.
 *
 * Sliced out of the prediction's payload rather than fetched per record — the
 * SHAP values were computed once for the whole batch.
 */
export function LocalWaterfallChart({
  predictionId,
  recordId,
}: {
  predictionId?: string;
  recordId?: string;
}) {
  return (
    <ChartFrame
      predictionId={predictionId}
      title="Contribution breakdown"
      emptyLabel="No explanation available for this prediction."
      rowHeight={30}
      showPrecision
    >
      {({ explanation, maxDisplay, decimals, width, rowHeight }) => {
        const sampleIndex = sampleIndexOf(explanation, recordId);
        if (sampleIndex < 0) {
          return (
            <div className="text-sm text-gray-500 py-2">
              This record is not in the prediction&apos;s explanation.
            </div>
          );
        }
        return (
          <ShapWaterfall
            explanation={explanation}
            sampleIndex={sampleIndex}
            maxDisplay={maxDisplay}
            decimals={decimals}
            width={width}
            rowHeight={rowHeight}
          />
        );
      }}
    </ChartFrame>
  );
}
