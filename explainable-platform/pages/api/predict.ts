import { AxiosProgressEvent } from "axios";
import { httpClient } from "./httpClient";
import {
  IModelInfo,
  IModelPayload,
  IPredictionRecords,
  IPredictions,
  IPredictResponse,
} from "@/components/model/model.interface";
import {
  IPagination,
  IPaginationRequestParams,
} from "@/components/model/pagination.interface";

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

export const getPredictions = async (params: IPaginationRequestParams) => {
  const { data } = await httpClient.get<IPagination<IPredictions>>(`/predict`, {
    params: { page: params.page },
  });
  return data;
};

export const getPredictionRecords = async (id: string, params: IPaginationRequestParams) => {
  const { data } = await httpClient.get<IPagination<IPredictionRecords>>(`/predict/${id}/records`, {
    params,
  });
  return data;
};
