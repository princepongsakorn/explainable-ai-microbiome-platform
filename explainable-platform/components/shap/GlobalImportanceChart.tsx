import { useEffect, useState } from "react";
import { getExplanation } from "@/pages/api/predict";
import type { Explanation } from "@/packages/shap-svg";
import { ShapBar } from "@/packages/shap-svg/react";

const MIN_DISPLAY = 5;
const MAX_DISPLAY = 50;
const DEFAULT_DISPLAY = 15;

interface Props {
  predictionId?: string;
  /** Called with the index of the feature the user clicked, if anything. */
  onFeatureClick?: (featureIndex: number | null) => void;
}

/**
 * Mean absolute SHAP value per feature, drawn in the browser from the
 * Explanation payload.
 *
 * The payload is fetched once. Moving the slider re-renders from data already in
 * memory — it issues no request, which is the whole point of shipping values
 * instead of a rendered image.
 */
export default function GlobalImportanceChart({
  predictionId,
  onFeatureClick,
}: Props) {
  const [explanation, setExplanation] = useState<Explanation>();
  const [maxDisplay, setMaxDisplay] = useState(DEFAULT_DISPLAY);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!predictionId) return;

    let cancelled = false;
    setExplanation(undefined);
    setError(undefined);

    getExplanation(predictionId)
      .then((data) => {
        if (!cancelled) setExplanation(data);
      })
      .catch((requestError) => {
        if (cancelled) return;
        // A 404 here means "not computed yet", which is a normal state while the
        // job runs — not something to shout about.
        setError(
          requestError?.response?.status === 404
            ? "The explanation is still being prepared."
            : "The explanation could not be loaded."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [predictionId]);

  if (error) {
    return <div className="text-sm text-gray-500 py-4">{error}</div>;
  }

  if (!explanation) {
    return (
      <div className="text-sm text-gray-400 py-4">Loading explanation…</div>
    );
  }

  const featureCount = explanation.feature_names.length;
  const sliderMax = Math.min(MAX_DISPLAY, featureCount);

  return (
    <div>
      <div className="flex items-center gap-3 text-sm text-gray-600 mb-2">
        <label htmlFor="max-display">Features shown</label>
        <input
          id="max-display"
          type="range"
          min={MIN_DISPLAY}
          max={sliderMax}
          value={Math.min(maxDisplay, sliderMax)}
          onChange={(event) => setMaxDisplay(Number(event.target.value))}
          className="flex-1"
        />
        <span className="tabular-nums w-16 text-right">
          {Math.min(maxDisplay, sliderMax)} / {featureCount}
        </span>
      </div>
      <div className="overflow-x-auto">
        <ShapBar
          explanation={explanation}
          maxDisplay={Math.min(maxDisplay, sliderMax)}
          onFeatureClick={onFeatureClick}
        />
      </div>
    </div>
  );
}
