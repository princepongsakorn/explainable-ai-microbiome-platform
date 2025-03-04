import { httpClient } from "./httpClient";

export const getMLFlowTrackingUri = async () => {
  const { data } = await httpClient.get<{ url: string }>(
    `/mlflow/tracking_uri`
  );
  return data;
};
