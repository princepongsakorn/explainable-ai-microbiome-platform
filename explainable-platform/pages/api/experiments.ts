import {
  IExperimentResponse,
  IExperimentsRunRequestParams,
  IExperimentsRunResponse,
  IRunResponse,
} from "@/components/model/experiments.interface";
import { httpClient } from "./httpClient";

export const getExperimentsList = async () => {
  const { data } = await httpClient.get<IExperimentResponse>("/experiments");
  return data;
};

export const getExperimentsById = async (
  id: string,
  params: IExperimentsRunRequestParams
) => {
  const { data } = await httpClient.get<IExperimentsRunResponse>(
    `/experiments/${id}`,
    {
      params,
    }
  );
  return data;
};

export const getRunById = async (id: string) => {
  const { data } = await httpClient.get<IRunResponse>(`/experiments/run/${id}`);
  return data;
};

export const putPublicModelByRunId = async (id: string) => {
  const { data } = await httpClient.put<IRunResponse>(
    `/experiments/run/publish-model/${id}`
  );
  return data;
};

export const putUnPublicModelByRunId = async (id: string) => {
  const { data } = await httpClient.put<IRunResponse>(
    `/experiments/run/unpublish-model/${id}`
  );
  return data;
};
