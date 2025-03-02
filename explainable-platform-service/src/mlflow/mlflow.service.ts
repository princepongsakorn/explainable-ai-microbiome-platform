import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import {
  IExperimentResponse,
  IExperimentsRunResponse,
  IRunResponse,
  ModelStage,
} from 'src/interface/experiments.interface';

@Injectable()
export class MlflowService {
  private inferenceServiceURL: string;
  private hostHeader = 'kserve-custom-inference-service.default.example.com';

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.inferenceServiceURL =
      this.configService.get<string>('INFERENCE_SERVICE_URL') ?? '';
  }

  async fetchExperiments() {
    try {
      const response = await lastValueFrom(
        this.httpService.get<IExperimentResponse>(
          `${this.inferenceServiceURL}/v1/mlflow/experiments`,
          {
            headers: { Host: this.hostHeader },
          },
        ),
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch experiments`, error);
      throw error;
    }
  }

  async getExperimentById(
    experimentId: string,
    orderBy?: string,
    pageToken?: string,
  ) {
    try {
      const response = await lastValueFrom(
        this.httpService.get<IExperimentsRunResponse>(
          `${this.inferenceServiceURL}/v1/mlflow/experiment/${experimentId}`,
          {
            headers: { Host: this.hostHeader },
            params: { order_by: orderBy, page_token: pageToken },
          },
        ),
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch experiments`, error);
      throw error;
    }
  }

  async getRunById(runId: string) {
    try {
      const response = await lastValueFrom(
        this.httpService.get<IRunResponse>(
          `${this.inferenceServiceURL}/v1/mlflow/run/${runId}`,
          {
            headers: { Host: this.hostHeader },
          },
        ),
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch run by id`, error);
      throw error;
    }
  }

  async putUpdateModelById(runId: string, stage: ModelStage) {
    try {
      const response = await lastValueFrom(
        this.httpService.put<IRunResponse>(
          `${this.inferenceServiceURL}/v1/mlflow/run/${runId}/stage`,
          { stage: stage, archive_existing_versions: true },
          { headers: { Host: this.hostHeader } },
        ),
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch run by id`, error);
      throw error;
    }
  }

  async getRegisteredModel() {
    try {
      const response = await lastValueFrom(
        this.httpService.put<IRunResponse>(
          `${this.inferenceServiceURL}/v1/mlflow/registered-models`,
          { headers: { Host: this.hostHeader } },
        ),
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch registered models`, error);
      throw error;
    }
  }
  
}
