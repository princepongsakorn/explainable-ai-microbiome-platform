import { useEffect, useReducer } from "react";
import { getExplanation } from "@/pages/api/predict";
import { parseExplanation } from "shap-svg";
import type { Explanation } from "shap-svg";

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
  /** Invalidated while a request was in flight; its answer is discarded. */
  stale?: boolean;
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

type RequestError = {
  response?: { status?: number; data?: { message?: unknown } };
};

function messageFor(error: RequestError): string {
  const status = error?.response?.status;
  // 404 means "not computed yet", which is the normal state while the job runs
  // and for predictions made before this pipeline existed.
  if (status === 404) return "No explanation for this prediction yet.";
  // 422 means the job ran and failed; the server's message says why.
  const message = error?.response?.data?.message;
  if (status === 422 && typeof message === "string") return message;
  return "The explanation could not be loaded.";
}

function load(predictionId: string) {
  const entry = entryFor(predictionId);
  if (entry.loading) return;

  entry.loading = true;
  entry.stale = false;
  entry.error = undefined;
  notify(entry);

  getExplanation(predictionId)
    .then(
      (data) => {
        if (entry.stale) return;
        entry.data = data;
        entry.error = undefined;
        entry.progress = undefined;
      },
      (requestError: RequestError) => {
        if (entry.stale) return;
        // No response at all — the network dropped — says nothing about the
        // explanation, so a chart that is already drawn stays drawn.
        if (entry.data && !requestError?.response) return;
        entry.data = undefined;
        entry.error = messageFor(requestError);
        // The frame shows progress ahead of an error, so a failure after any
        // progress event would otherwise read "Computing…" indefinitely.
        entry.progress = undefined;
      }
    )
    .then(() => {
      entry.loading = false;
      // Every chart unmounted while the request was in flight. The effect
      // cleanup left the entry for this moment rather than drop a live request.
      if (entry.listeners.size === 0) {
        if (store.get(predictionId) === entry) store.delete(predictionId);
        return;
      }
      if (entry.stale) {
        load(predictionId);
        return;
      }
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
  if (entry.loading) {
    // The request in flight may have left before the change it is being told
    // about — a 404 sent just before the job finished — so fetch again once it
    // lands instead of trusting its answer.
    entry.stale = true;
    return;
  }
  load(predictionId);
}

/**
 * Fetch a Prediction's Explanation again, keeping what is drawn meanwhile.
 *
 * For an SSE (re)connect: events sent while the socket was down are lost, so a
 * finished or rebuilt explanation may have gone unannounced. An unchanged one
 * costs a 304.
 */
export function revalidateExplanation(predictionId: string) {
  const entry = store.get(predictionId);
  if (!entry) return;
  if (entry.loading) {
    entry.stale = true;
    return;
  }
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

/**
 * A Sample's Model output, read straight off the payload.
 *
 * `f(x)` is the Base value plus that Sample's SHAP values — an invariant of the
 * explanation contract, not an approximation — so a breakdown opened from a
 * cohort chart can show it without fetching the record.
 *
 * Returns undefined for a Sample the payload does not cover, rather than a
 * number that would be wrong.
 */
export function modelOutputOf(
  explanation: Explanation | undefined,
  sampleIndex: number | null
): number | undefined {
  if (!explanation || sampleIndex === null) return undefined;
  const parsed = parseExplanation(explanation);
  const row = parsed.values[sampleIndex];
  if (!row) return undefined;
  return parsed.baseValues[sampleIndex] + row.reduce((sum, value) => sum + value, 0);
}
