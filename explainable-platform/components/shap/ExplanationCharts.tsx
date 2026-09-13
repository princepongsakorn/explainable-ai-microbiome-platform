import { ReactNode, useState } from "react";
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

/**
 * Shared shell: fetch state, the feature-count slider, and horizontal scrolling.
 *
 * The slider changes only what is drawn from a payload already in memory, which
 * is the point of shipping values instead of a rendered image — there is no
 * request behind it.
 */
function ChartFrame({
  predictionId,
  children,
  emptyLabel,
  showPrecision = false,
}: {
  predictionId?: string;
  emptyLabel: string;
  /** Offer the decimal-places control. Only the waterfall labels each bar. */
  showPrecision?: boolean;
  children: (
    explanation: Explanation,
    maxDisplay: number,
    decimals: ValuePrecision
  ) => ReactNode;
}) {
  const { explanation, error, loading } = useExplanation(predictionId);
  const [maxDisplay, setMaxDisplay] = useState(DEFAULT_DISPLAY);
  const [decimals, setDecimals] = useState<ValuePrecision>(DEFAULT_PRECISION);

  if (loading) {
    return <div className="text-sm text-gray-400 py-4">Loading explanation…</div>;
  }
  if (error || !explanation) {
    return <div className="text-sm text-gray-500 py-4">{error ?? emptyLabel}</div>;
  }

  const featureCount = explanation.feature_names.length;
  const sliderMax = Math.min(MAX_DISPLAY, featureCount);
  const shown = Math.min(maxDisplay, sliderMax);

  return (
    <div>
      <div className="flex items-center gap-3 text-sm text-gray-600 mb-2">
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
      <div className="overflow-x-auto">{children(explanation, shown, decimals)}</div>
    </div>
  );
}

/** Mean absolute SHAP value per feature, across every sample in the prediction. */
export function GlobalImportanceChart({ predictionId }: { predictionId?: string }) {
  return (
    <ChartFrame predictionId={predictionId} emptyLabel="No explanation available.">
      {(explanation, maxDisplay) => (
        <ShapBar explanation={explanation} maxDisplay={maxDisplay} />
      )}
    </ChartFrame>
  );
}

/** One dot per sample per feature, coloured by that sample's abundance. */
export function GlobalBeeswarmChart({ predictionId }: { predictionId?: string }) {
  return (
    <ChartFrame predictionId={predictionId} emptyLabel="No explanation available.">
      {(explanation, maxDisplay) => (
        <ShapBeeswarm explanation={explanation} maxDisplay={maxDisplay} />
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
    <ChartFrame predictionId={predictionId} emptyLabel="No explanation available.">
      {(explanation, maxDisplay) => (
        <ShapHeatmap
          explanation={explanation}
          maxDisplay={maxDisplay}
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
      emptyLabel="No explanation available for this prediction."
      showPrecision
    >
      {(explanation, maxDisplay, decimals) => {
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
          />
        );
      }}
    </ChartFrame>
  );
}
