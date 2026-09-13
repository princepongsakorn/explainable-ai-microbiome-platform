import { useEffect, useReducer } from "react";
import { getExplanation } from "@/pages/api/predict";
import type { Explanation } from "@/packages/shap-svg";

export interface ExplanationProgress {
  done: number;
  total: number;
}

export interface ExplanationState {
  explanation?: Explanation;
  /** A human-readable reason, or undefined while loading or once loaded. */
  error?: string;
  loading: boolean;
  /** How far the server is through computing it, while it is still working. */
  progress?: ExplanationProgress;
}

type Entry = {
  data?: Explanation;
  error?: string;
  loading: boolean;
  progress?: ExplanationProgress;
  listeners: Set<() => void>;
};

/**
 * One Explanation per Prediction, shared by every chart drawing it.
 *
 * Each chart used to own its own fetch, so opening a prediction pulled the
 * payload once per chart — three parallel requests for the same ~600 KiB on the
 * prediction page, none of which could hit the ETag because none had finished.
 * Keying by Prediction id here makes it one request no matter how many charts
 * mount, and gives the SSE handler a single place to say "this changed".
 *
 * The entry is dropped when the last chart unmounts rather than kept as a cache:
 * holding a multi-megabyte parsed payload for a drawer nobody has open is worse
 * than re-requesting it, and a re-request is the cheap conditional GET the ETag
 * was added for.
 */
const store = new Map<string, Entry>();

function entryFor(predictionId: string): Entry {
  let entry = store.get(predictionId);
  if (!entry) {
    entry = { loading: false, listeners: new Set() };
    store.set(predictionId, entry);
  }
  return entry;
}

function notify(entry: Entry) {
  entry.listeners.forEach((listener) => listener());
}

function messageFor(error: { response?: { status?: number } }): string {
  // 404 means "not computed yet", which is the normal state while the job runs
  // and for predictions made before this pipeline existed.
  return error?.response?.status === 404
    ? "No explanation for this prediction yet."
    : "The explanation could not be loaded.";
}

function load(predictionId: string) {
  const entry = entryFor(predictionId);
  if (entry.loading) return;

  entry.loading = true;
  entry.error = undefined;
  notify(entry);

  getExplanation(predictionId)
    .then(
      (data) => {
        entry.data = data;
        entry.error = undefined;
        entry.progress = undefined;
      },
      (requestError) => {
        entry.data = undefined;
        entry.error = messageFor(requestError);
      }
    )
    .then(() => {
      entry.loading = false;
      notify(entry);
    });
}

/**
 * Re-fetch a Prediction's Explanation because the server says it changed.
 *
 * Call this from the SSE handler on `prediction:explanation`. Without it a
 * drawer opened while the job is still running shows "not computed yet" until
 * the user reloads the page — and the job takes about a minute for a few
 * hundred Samples, so that is the common case, not the rare one.
 */
export function invalidateExplanation(predictionId: string) {
  const entry = store.get(predictionId);
  if (!entry) return;

  if (entry.listeners.size === 0) {
    store.delete(predictionId);
    return;
  }
  entry.data = undefined;
  load(predictionId);
}

/** Report how far the server is through computing an Explanation. */
export function setExplanationProgress(
  predictionId: string,
  progress: ExplanationProgress
) {
  const entry = store.get(predictionId);
  if (!entry) return;
  entry.progress = progress;
  notify(entry);
}

/** Fetch one Prediction's Explanation, sharing it with every other caller. */
export function useExplanation(predictionId?: string): ExplanationState {
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!predictionId) return;

    const entry = entryFor(predictionId);
    entry.listeners.add(rerender);
    if (!entry.data && !entry.loading) load(predictionId);

    return () => {
      entry.listeners.delete(rerender);
      // Not while a request is in flight: React 18 runs effects twice in
      // development, and deleting between the two runs would start a second
      // fetch for the one that is already going.
      if (entry.listeners.size === 0 && !entry.loading) {
        store.delete(predictionId);
      }
    };
  }, [predictionId]);

  if (!predictionId) return { loading: false };

  const entry = store.get(predictionId);
  return {
    explanation: entry?.data,
    error: entry?.error,
    // No entry yet means the effect has not run, which is still loading.
    loading: entry?.loading ?? true,
    progress: entry?.progress,
  };
}

/** Index of a Prediction Record's row in the Explanation, or -1. */
export function sampleIndexOf(
  explanation: Explanation | undefined,
  recordId?: string
): number {
  if (!explanation?.sample_ids || !recordId) return -1;
  return explanation.sample_ids.indexOf(recordId);
}
