export enum PredictionClass {
  ALL = 'ALL',
  POSITIVE = 'POSITIVE',
  NEGATIVE = 'NEGATIVE',
}

export enum PredictionStatus {
  ALL = 'ALL',
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
  CANCELED = 'CANCELED'
}

/**
 * Why a SHAP plot (waterfall / beeswarm / heatmap) is missing. Lets the
 * frontend tell the two failure modes apart and offer a targeted re-gen:
 *   IMAGE_FAILED  — the inference service could not produce a usable plot
 *                   (call errored, or returned a blank/empty PNG).
 *   UPLOAD_FAILED — the plot was produced fine, but uploading it to GCS /
 *                   generating its signed URL failed.
 */
export enum ImageGenStatus {
  IMAGE_FAILED = 'IMAGE_FAILED',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
}
