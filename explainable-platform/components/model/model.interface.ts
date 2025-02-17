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

export interface IPredictionRecords {
  id: string;
  proba?: number;
  class?: number;
  waterfall?: string;
  status?: PredictionStatus
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
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}