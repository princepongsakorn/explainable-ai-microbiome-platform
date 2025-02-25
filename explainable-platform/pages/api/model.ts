import { httpClient } from "./httpClient";
import { IModelInfo } from "@/components/model/model.interface";

export const getModelsList = async () => {
  const { data } = await httpClient.get<IModelInfo[]>("/models");
  return data;
};
