import { httpClient } from "./httpClient";
import { IModelType, IProductionModelInfo } from "@/components/model/model.interface";

export const getModelsList = async () => {
  const { data } = await httpClient.get<IProductionModelInfo[]>("/models");
  return data;
};

export const getModelsType = async () => {
  const { data } = await httpClient.get<IModelType[]>("/models/model-type");
  return data;
};
