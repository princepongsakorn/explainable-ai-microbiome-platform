import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { ModelType } from 'src/entity/model-type.entity';
import { In, Repository } from 'typeorm';
import { IProductionModels } from 'src/interface/experiments.interface';
import { validate as isUuid } from 'uuid';

@Injectable()
export class ModelsService {
  private inferenceServiceURL: string;
  private hostHeader = 'kserve-custom-inference-service.default.example.com';

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
    @InjectRepository(ModelType)
    private readonly modelTypeRepository: Repository<ModelType>,
  ) {
    this.inferenceServiceURL =
      this.configService.get<string>('INFERENCE_SERVICE_URL') ?? '';
  }

  async fetchProductionModels() {
    try {
      const response = await lastValueFrom(
        this.httpService.get<IProductionModels[]>(
          `${this.inferenceServiceURL}/v1/models`,
          {
            headers: { Host: this.hostHeader },
          },
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

  async fetchAllModelTypes(): Promise<ModelType[]> {
    return this.modelTypeRepository.find({ order: { name: 'ASC' } });
  }
}

const test = [
  {
    name: 'rf-crc-e2e',
    version: '1',
    creation_timestamp: 1747993322445,
    last_updated_timestamp: 1747994167373,
    current_stage: 'Production',
    description:
      '{"model":"89d219b2-c3f9-44d1-b5b6-56d62965d081","description":"ทำนายโรค CRC โดยแบบจำลองนี้สร้างขึ้นใน e2e test "}',
    source:
      'mlflow-artifacts:/16/30ce6a1a452f475ebba6337b09085a5b/artifacts/model',
    run_id: '30ce6a1a452f475ebba6337b09085a5b',
    status: 'READY',
    run_link: '',
    metrics: {
      precision: 0.807,
      f1: 0.8,
      accuracy: 0.806,
      recall: 0.806,
      roc_auc: 0.883,
    },
  },
  {
    name: 'sample-crc',
    version: '38',
    creation_timestamp: 1737387903711,
    last_updated_timestamp: 1744695067480,
    current_stage: 'Production',
    description: 'test1010101',
    source:
      's3://mlflow-bucket-23641cea-0eea-4ae4-88aa-a65a9d467b27/6/e5d9b370abed4926bd15fc707d9c8c0d/artifacts/model',
    run_id: 'e5d9b370abed4926bd15fc707d9c8c0d',
    status: 'READY',
    run_link: '',
    metrics: {
      accuracy: 0.861,
      precision: 0.86,
      recall: 0.861,
      f1: 0.86,
      roc_auc: 0.911,
    },
  },
  {
    name: 'sample-gradient-boosting-crc',
    version: '100',
    creation_timestamp: 1738569070420,
    last_updated_timestamp: 1744729303917,
    current_stage: 'Production',
    description:
      '{"model":"89d219b2-c3f9-44d1-b5b6-56d62965d081","description":"Test add Description"}',
    source:
      'mlflow-artifacts:/11/3dc81f16b2384d0ea80c8561dc00149a/artifacts/model',
    run_id: '3dc81f16b2384d0ea80c8561dc00149a',
    status: 'READY',
    run_link: '',
    metrics: {
      f1: 0.831,
      precision: 0.833,
      accuracy: 0.833,
      roc_auc: 0.903,
      recall: 0.833,
    },
  },
  {
    name: 'sample-xgboost-crc',
    version: '92',
    creation_timestamp: 1737466891648,
    last_updated_timestamp: 1740501376081,
    current_stage: 'Production',
    description: '',
    source:
      'mlflow-artifacts:/9/8a8e70a34bb047e8b5098c101da60a97/artifacts/model',
    run_id: '8a8e70a34bb047e8b5098c101da60a97',
    status: 'READY',
    run_link: '',
    metrics: {
      accuracy: 0.861,
      roc_auc: 0.899,
      f1: 0.857,
      precision: 0.867,
      recall: 0.861,
    },
  },
];
