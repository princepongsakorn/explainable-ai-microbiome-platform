import { AxiosProgressEvent } from "axios";
import { httpClient } from "./httpClient";
import {
  IModelInfo,
  IModelPayload,
  IPredictResponse,
} from "@/components/model/model.interface";

export const getModelsList = async () => {
  const { data } = await httpClient.get<IModelInfo[]>("/v1/models");
  return data;
};

export const postModelPredict = async (
  model: string,
  payload: IModelPayload,
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void
) => {
  const { data } = await httpClient.post<IPredictResponse>(
    `/v1/predict/${model}`,
    payload,
    {
      onUploadProgress,
    }
  );
  return data;
};
