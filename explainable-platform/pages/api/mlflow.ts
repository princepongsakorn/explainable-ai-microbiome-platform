import { httpClient } from "./httpClient";

export const getMLFlowTrackingUri = async () => {
  const { data } = await httpClient.get<{ url: string }>(
    `/mlflow/tracking_uri`
  );
  return data;
};

export const getMLFlowToken = async () => {
  const { data } = await httpClient.get<{ user: string; token?: string }>(
    `/mlflow/token`
  );
  return data;
};

export const generateMLFlowToken = async () => {
  const { data } = await httpClient.post<{ user: string; token: string }>(
    `/mlflow/token`
  );
  return data;
};
