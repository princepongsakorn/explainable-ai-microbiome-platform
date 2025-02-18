export interface IModelInfo {
  metrics: IMetrics;
  model_name: string;
  run_id: string;
  version: string;
}

export interface IMetrics {
  accuracy?: number;
  f1?: number;
  precision?: number;
  recall?: number;
  roc_auc?: number;
}

export interface IModelPayload {
  dataframe_split: {
    columns: string[];
    data: number[][];
  };
}

export interface ICreatePredictions {
  message: string
  predictionId: string
}

export interface IPredictionRecords {
  id: string;
  proba?: number;
  class?: number;
  waterfall?: string;
  status?: PredictionStatus
  dfColumns?: string[]
  dfData?: string[]
  errorMsg?: string
}
export interface IPredictions {
  id: string;
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

export enum PredictionClass {
  ALL = "ALL",
  POSITIVE = "POSITIVE",
  NEGATIVE = "NEGATIVE"
}

export enum PredictionStatus {
  ALL = 'ALL',
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}