import { AxiosProgressEvent } from "axios";
import { httpClient } from "./httpClient";

export interface IPredictResponse {
  local_explanation_predictions: LocalExplanationPrediction[];
}

export interface LocalExplanationPrediction {
  index: number;
  pred_proba: number;
  pred_class: number;
  plot: string;
}
export interface IModelPayload {
  dataframe_split: {
    columns: any;
    data: any[];
  };
}

export const getModelsList = async () => {
  const { data } = await httpClient.get<{ models: string[] }>("/v1/models");
  return data;
};

export const postModelPredict = async (
  model: string,
  payload: IModelPayload,
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void
) => {
  const { data } = await httpClient.post<IPredictResponse>(
    `/v1/models/${model}:predict`,
    payload,
    {
      onUploadProgress,
    }
  );
  return data;
};
