import {
  IExperimentResponse,
  IExperimentsRunRequestParams,
  IExperimentsRunResponse,
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
