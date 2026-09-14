import {
  IExperimentResponse,
  IExperimentsRunRequestParams,
  IExperimentsRunResponse,
  IRegisteredModelResponse,
  IRunResponse,
} from "@/components/model/experiments.interface";
import { httpClient } from "./httpClient";
import { IModelType } from "@/components/model/model.interface";

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

export const getExperimentsModelList = async () => {
  const { data } = await httpClient.get<IRegisteredModelResponse>(
    "/experiments/models"
  );
  return data;
};

/** One version of a registered model, with the run that produced it. */
export const getModelVersionRun = async (name: string, version: string) => {
  const { data } = await httpClient.get<{
    name: string;
    version: string;
    run_id: string;
    current_stage: string;
  }>(
    `/experiments/models/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`
  );
  return data;
};

export const postDescriptionExperiments = async (
  experimentId: string,
  description?: string
) => {
  const { data } = await httpClient.post(
    `/experiments/description/${experimentId}`,
    {
      description: description ?? "",
    }
  );
  return data;
};

export const getRunById = async (id: string) => {
  const { data } = await httpClient.get<IRunResponse>(`/experiments/run/${id}`);
  return data;
};

export const putPublicModelByRunId = async (
  id: string,
  description: { model?: IModelType; description?: string }
) => {
  const { data } = await httpClient.put<IRunResponse>(
    `/experiments/run/publish-model/${id}`,
    {
      description: JSON.stringify({
        model: description?.model?.id,
        description: description?.description,
      }),
    }
  );
  return data;
};

export const putUnPublicModelByRunId = async (id: string) => {
  const { data } = await httpClient.put<IRunResponse>(
    `/experiments/run/unpublish-model/${id}`
  );
  return data;
};
