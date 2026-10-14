import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { isAxiosError } from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { ModelType } from 'src/entity/model-type.entity';
import { In, Repository } from 'typeorm';
import { IProductionModels } from 'src/interface/experiments.interface';
import { IProductionVersionResponse } from 'src/interface/prediction-api.interface';
import { validate as isUuid } from 'uuid';

@Injectable()
export class ModelsService {
  private inferenceServiceURL: string;

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
    @InjectRepository(ModelType)
    private readonly modelTypeRepository: Repository<ModelType>,
  ) {
    this.inferenceServiceURL =
      this.configService.get<string>('INFERENCE_SERVICE_URL') ?? '';
  }

  /**
   * The models currently in Production, as the inference service reports them.
   * A model's MLflow description is JSON whose `model` field is a ModelType id;
   * it is swapped for that type's name here. Descriptions that are not this
   * JSON are passed through as plain text.
   */
  async fetchProductionModels() {
    try {
      const response = await lastValueFrom(
        this.httpService.get<IProductionModels[]>(
          `${this.inferenceServiceURL}/v1/models`,
        ),
      );
      const models = response.data;
      const modelTypeIds = models
        .map((m) => {
          try {
            const parsed = JSON.parse(m.description);
            if (parsed?.model && isUuid(parsed.model)) return parsed.model;
          } catch (_) {}
          return null;
        })
        .filter((id): id is string => id !== null);

      const modelTypes = await this.modelTypeRepository.findBy({
        id: In(modelTypeIds),
      });
      const modelTypeMap = new Map(modelTypes.map((m) => [m.id, m.name]));
      const transformedModels = models.map((model) => {
        try {
          const parsed = JSON.parse(model.description);
          if (parsed?.model && isUuid(parsed.model)) {
            const modelName = modelTypeMap.get(parsed.model);
            return {
              ...model,
              description: {
                model: modelName || null,
                description: parsed.description ?? '',
              },
            };
          }
        } catch (_) {}

        return {
          ...model,
          description: {
            model: null,
            description: model.description || '',
          },
        };
      });
      return transformedModels;
    } catch (error) {
      console.error(`Failed to fetch models`, error);
      throw error;
    }
  }

  /**
   * The version of `modelName` in Production right now, asked of the registry
   * rather than any cache. Null when the registry says nothing is in Production;
   * any other failure is thrown.
   */
  async fetchProductionVersion(modelName: string): Promise<string | null> {
    try {
      const response = await lastValueFrom(
        this.httpService.get<IProductionVersionResponse>(
          `${this.inferenceServiceURL}/v1/models/${encodeURIComponent(modelName)}/production`,
        ),
      );
      return String(response.data.version);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) return null;
      throw error;
    }
  }

  async fetchAllModelTypes(): Promise<ModelType[]> {
    return this.modelTypeRepository.find({ order: { name: 'ASC' } });
  }
}
