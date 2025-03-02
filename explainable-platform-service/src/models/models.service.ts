import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { IGetModelsResponse } from 'src/interface/models-api.interface';

@Injectable()
export class ModelsService {
  private inferenceServiceURL: string;
  private hostHeader = 'kserve-custom-inference-service.default.example.com';

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.inferenceServiceURL =
      this.configService.get<string>('INFERENCE_SERVICE_URL') ?? '';
  }

  async fetchProductionModels() {
    try {
      const response = await lastValueFrom(
        this.httpService.get<IGetModelsResponse[]>(
          `${this.inferenceServiceURL}/v1/models`,
          {
            headers: { Host: this.hostHeader },
          },
        ),
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch models`, error);
      throw error;
    }
  }
}
