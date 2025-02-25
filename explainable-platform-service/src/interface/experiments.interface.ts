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
  tags: {};
}

export interface IExperimentsRunResponse {
  nextPageToken: string;
  runs: IRun[];
}
export interface IRun {
  data: IRunData;
  info: IRunInfo;
}

export interface IRunResponse {
  data: IRunData;
  info: IRunInfo;
  models: IModel[];
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

export enum ModelStage {
  None = "None",
  Staging = "Staging",
  Production = "Production",
  Archived = "Archived",
}
