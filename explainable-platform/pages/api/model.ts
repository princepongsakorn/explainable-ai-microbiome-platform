import { AxiosProgressEvent } from "axios";
import { httpClient } from "./httpClient";
export interface IPredictResponse {
  summary: {
    beeswarm: string; //base64 of beeswarm
    heatmap: string; //base64 of heatmap
  };
  predictions: IPredictions[];
}
export interface IPredictions {
  id: string;
  proba: number;
  class: number;
  plot: {
    waterfall: string; //base64 of waterfall
  };
}
export interface IModelPayload {
  dataframe_split: {
    columns: string[];
    data: number[][];
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
