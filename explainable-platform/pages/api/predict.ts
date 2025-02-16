import { AxiosProgressEvent } from "axios";
import { httpClient } from "./httpClient";
import {
  IModelInfo,
  IModelPayload,
  IPredictions,
  IPredictResponse,
} from "@/components/model/model.interface";

export const postModelPredict = async (
  dataFile: File,
  modelName: string,
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void
) => {
  const formData = new FormData();
  formData.append("file", dataFile);
  formData.append("modelName", modelName);
  const { data } = await httpClient.post<IPredictResponse>(
    `/predict`,
    formData,
    {
      onUploadProgress,
    }
  );
  return data;
};

export const getPredictions = async () => {
  const { data } = await httpClient.get<IPredictions[]>(`/predict`);
  return data;
};
