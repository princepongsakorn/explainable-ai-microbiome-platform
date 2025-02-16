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

export interface IPredictResponse {
  summary: {
    beeswarm: string; //base64 of beeswarm
    heatmap: string; //base64 of heatmap
  };
  predictions: IPredictions[];
}

// export interface IPredictions {
//   id: string;
//   proba: number;
//   class: number;
//   plot: {
//     waterfall: string; //base64 of waterfall
//   };
// }

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
