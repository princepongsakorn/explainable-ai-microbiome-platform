import { AxiosProgressEvent } from "axios";
import { httpClient } from "./httpClient";
import {
  IPredictionRecords,
  IPredictions,
  ICreatePredictions,
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
  const { data } = await httpClient.post<ICreatePredictions>(
    `/predict`,
    formData,
    {
      onUploadProgress,
    }
  );
  return data;
};

export const postRePredict = async (id: string) => {
  const { data } = await httpClient.post<ICreatePredictions>(
    `/predict/${id}/re-predict`
  );
  return data;
};

export const postCancelPredict = async (id: string) => {
  const { data } = await httpClient.post<ICreatePredictions>(
    `/predict/${id}/cancel`
  );
  return data;
};

export const getPredictions = async (params: IPaginationRequestParams) => {
  const { data } = await httpClient.get<IPagination<IPredictions>>(`/predict`, {
    params: { page: params.page },
  });
  return data;
};

export const getPredictionRecords = async (
  id: string,
  params: IPaginationRequestParams
) => {
  const { data } = await httpClient.get<IPagination<IPredictionRecords>>(
    `/predict/${id}/records`,
    {
      params,
    }
  );
  return data;
};
