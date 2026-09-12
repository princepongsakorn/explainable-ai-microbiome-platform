import { useEffect, useState } from "react";
import { getExplanation } from "@/pages/api/predict";
import type { Explanation } from "@/packages/shap-svg";

export interface ExplanationState {
  explanation?: Explanation;
  /** A human-readable reason, or undefined while loading or once loaded. */
  error?: string;
  loading: boolean;
}

/**
 * Fetch one Prediction's Explanation.
 *
 * Every chart on a prediction is drawn from this single payload, and the response
 * carries an ETag — so a second chart, a re-opened drawer or a refresh costs a
 * conditional request the server answers 304 from one database read. There is no
 * need to lift this into a shared store.
 */
export function useExplanation(predictionId?: string): ExplanationState {
  const [explanation, setExplanation] = useState<Explanation>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!predictionId) {
      setExplanation(undefined);
      setError(undefined);
      return;
    }

    let cancelled = false;
    setExplanation(undefined);
    setError(undefined);
    setLoading(true);

    getExplanation(predictionId)
      .then((data) => {
        if (!cancelled) setExplanation(data);
      })
      .catch((requestError) => {
        if (cancelled) return;
        // 404 means "not computed yet", which is the normal state while the job
        // runs and for predictions made before this pipeline existed.
        setError(
          requestError?.response?.status === 404
            ? "No explanation for this prediction yet."
            : "The explanation could not be loaded."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [predictionId]);

  return { explanation, error, loading };
}

/** Index of a Prediction Record's row in the Explanation, or -1. */
export function sampleIndexOf(
  explanation: Explanation | undefined,
  recordId?: string
): number {
  if (!explanation?.sample_ids || !recordId) return -1;
  return explanation.sample_ids.indexOf(recordId);
}
