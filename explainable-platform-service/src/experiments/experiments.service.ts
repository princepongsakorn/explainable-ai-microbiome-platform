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
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/entity/user.entity';
import { Repository } from 'typeorm';
import { validate as isUuid } from 'uuid';

@Injectable()
export class ExperimentsService {
  private inferenceServiceURL: string;
  private hostHeader = 'kserve-custom-inference-service.default.example.com';

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
    @InjectRepository(User) private userRepository: Repository<User>,
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
      const runs = response.data.runs;
      const userIds = Array.from(
        new Set(runs.map((run) => run.info.user_id).filter((id) => isUuid(id))),
      );
      const users = await this.userRepository.find({
        where: userIds.map((id) => ({ id })),
      });

      const userMap = new Map(users.map((u) => [u.id, u.username]));
      const enrichedRuns = runs.map((run) => ({
        ...run,
        info: {
          ...run.info,
          user_name: userMap.get(run.info.user_id) ?? run.info.user_id,
        },
      }));

      return { ...response.data, runs: enrichedRuns };
    } catch (error) {
      console.error(`Failed to fetch experiments`, error);
      throw error;
    }
  }

  async postUpdateDescriptionExperiments(
    experimentId: string,
    description: string,
  ) {
    try {
      const response = await lastValueFrom(
        this.httpService.post<IRunResponse>(
          `${this.inferenceServiceURL}/v1/mlflow/experiments/description/${experimentId}`,
          { description: description },
          { headers: { Host: this.hostHeader } },
        ),
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to update description experiments`, error);
      throw error;
    }
  }

  async getRunById(runId: string) {
    try {
      const response = await lastValueFrom(
        this.httpService.get<{ run: IRunResponse }>(
          `${this.inferenceServiceURL}/v1/mlflow/run/${runId}`,
          {
            headers: { Host: this.hostHeader },
          },
        ),
      );
      const run = response.data.run;
      const userId = run.info?.user_id;
      let user_name: string | null = null;

      if (isUuid(userId)) {
        const user = await this.userRepository.findOne({
          where: { id: userId },
        });
        user_name = user?.username || userId;
      } else {
        user_name = userId;
      }

      return {
        run: {
          ...run,
          info: {
            ...run.info,
            user_name,
          },
        },
      };
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
        this.httpService.get<IRunResponse>(
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
