export interface IGetModelsResponse {
  metrics: {
    accuracy: number;
    f1: number;
    precision: number;
    recall: number;
    roc_auc: number;
  };
  model_name: string;
  run_id: string;
  version: string;
}
