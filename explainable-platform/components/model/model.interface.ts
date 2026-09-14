import { IPaginationMeta } from "./pagination.interface";

export interface IProductionModelInfo {
  creation_timestamp: number
  current_stage: string
  description: {
    model?: string
    description: string
  }
  last_updated_timestamp: number
  metrics: IMetrics
  name: string
  run_id: string
  run_link: string
  source: string
  status: string
  version: string
}
export interface IModelInfo {
  metrics: IMetrics;
  model_name: string;
  run_id: string;
  version: string;
}

export interface IModelType {
  id: string;
  name: string;
  description: string;
}

export interface IMetrics {
  [key: string]: string;
}

export interface IModelPayload {
  dataframe_split: {
    columns: string[];
    data: number[][];
  };
}

export interface ICreatePredictions {
  message: string;
  predictionId: string;
}

// Why a SHAP plot is missing — mirrors the backend ImageGenStatus enum.
export enum ImageGenStatus {
  IMAGE_FAILED = "IMAGE_FAILED",
  UPLOAD_FAILED = "UPLOAD_FAILED",
}

export interface IPredictionRecords {
  id: string;
  record_number: number;
  proba?: number;
  class?: number;
  waterfall?: string;
  waterfallError?: ImageGenStatus | string | null;
  status?: PredictionStatus;
  dfColumns?: string[];
  dfData?: string[];
  errorMsg?: string;
  comment?: string
}
export interface IPredictions {
  id: string;
  predictionNumber: number;
  modelName: string;
  /**
   * The registry version of `modelName` that made this prediction. Recorded
   * since explanations started carrying it; null for older predictions.
   */
  modelVersion?: string | null;
  records: IRecordCounts;
  createdAt: string;
  heatmap?: string;
  heatmapError?: ImageGenStatus | string | null;
  beeswarm?: string;
  beeswarmError?: ImageGenStatus | string | null;
}

export interface IRecordCounts {
  total: number;
  success: number;
  error: number;
  /** Absent from a backend older than the counts; treat as unknown. */
  byStatus?: Record<Exclude<PredictionStatus, PredictionStatus.ALL>, number>;
  /** Samples per class value, e.g. { "0": 26, "1": 12 }. */
  byClass?: Record<string, number>;
}

export interface IPredictionSummary {
  inProgress: number;
  needsAttention: number;
  uploadedLast7Days: number;
}

export interface IPredictionsPagination {
  items: IPredictionRecords[];
  meta: IPaginationMeta;
  prediction: IPredictions;
}

export enum PredictionClass {
  ALL = "ALL",
  POSITIVE = "POSITIVE",
  NEGATIVE = "NEGATIVE",
}

export enum PredictionStatus {
  ALL = "ALL",
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  SUCCESS = "SUCCESS",
  ERROR = "ERROR",
  CANCELED = "CANCELED",
}
