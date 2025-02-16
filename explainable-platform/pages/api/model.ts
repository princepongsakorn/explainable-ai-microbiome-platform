import { AxiosProgressEvent } from "axios";
import { httpClient } from "./httpClient";
import {
  IModelInfo,
  IModelPayload,
  IPredictResponse,
} from "@/components/model/model.interface";

export const getModelsList = async () => {
  const { data } = await httpClient.get<IModelInfo[]>("/models");
  return data;
};