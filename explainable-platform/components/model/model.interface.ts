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

export interface IPredictionRecords {
  id: string;
  proba?: number;
  class?: number;
  waterfall?: string;
  status?: PredictionStatus;
  dfColumns?: string[];
  dfData?: string[];
  errorMsg?: string;
  record_number: number;
}
export interface IPredictions {
  id: string;
  predictionNumber: number;
  modelName: string;
  records: {
    total: number;
    success: number;
    error: number;
  };
  createdAt: string;
  heatmap?: string;
  beeswarm?: string;
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
