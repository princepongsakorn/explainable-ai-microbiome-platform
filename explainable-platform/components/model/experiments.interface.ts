import { IMetrics } from "./model.interface";

export interface IExperimentResponse {
  experiments: IExperiment[];
}

export interface IExperiment {
  artifact_location: string;
  creation_time: number;
  experiment_id: string;
  last_update_time: number;
  lifecycle_stage: string;
  name: string;
  tags: {
    [key: string]: string;
  };
}

export interface IExperimentsRunRequestParams {
  orderBy?: string;
  pageToken?: string;
}

export interface IExperimentsRunResponse {
  nextPageToken: string;
  runs: IRun[];
}

export interface IRunResponse {
  run: IRunDetail;
}

export interface IRunDetail {
  data: IRunData;
  info: IRunInfo;
  models: IModel[];
}

export interface IRun {
  data: IRunData;
  info: IRunInfo;
}

export interface IRunData {
  metrics: { [key: string]: string };
  parameters: { [key: string]: string };
}

export interface IRunInfo {
  artifact_uri: string;
  end_time: number;
  experiment_id: string;
  lifecycle_stage: string;
  run_id: string;
  run_name: string;
  run_uuid: string;
  start_time: number;
  status: string;
  user_id: string;
  user_name: string;
}

export interface IModel {
  aliases: any[];
  creation_time: number;
  current_stage: string;
  description: string;
  last_updated_timestamp: number;
  name: string;
  run_id: string;
  run_link: string;
  source: string;
  status: string;
  status_message: any;
  tags: { [key: string]: string };
  user_id: string;
  version: string;
}

export interface IRegisteredModelResponse {
  registered_models: RegisteredModel[];
}
export interface RegisteredModel {
  creation_timestamp: number;
  last_updated_timestamp: number;
  name: string;
  latest_versions?: IRegisteredModelLatestVersions[];
}

export interface IRegisteredModelLatestVersions {
  creation_timestamp: number;
  current_stage: string;
  description: string;
  last_updated_timestamp: number;
  name: string;
  run_id: string;
  run_link: string;
  source: string;
  status: string;
  version: string;
}
