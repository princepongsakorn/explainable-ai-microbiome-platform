import { lastValueFrom } from 'rxjs';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Prediction } from '../entity/prediction.entity';
import {
  PredictionRecord,
} from '../entity/prediction-record.entity';
import { StorageService } from '../storage/storage.service';
import { ConfigService } from '@nestjs/config';
import {
  IBeeswarmResponse,
  IDataframeSplitRequest,
  IHeatmapResponse,
  IPredictResponse,
  IWaterfallResponse,
} from 'src/interface/prediction-api.interface';
import { PredictionStatus } from 'src/interface/prediction-class.enum';

@Processor('predictionQueue')
export class PredictionProcessor {
  private inferenceServiceURL: string;
  private hostHeader = 'kserve-custom-inference-service.default.example.com';

  constructor(
    private httpService: HttpService,
    @InjectRepository(Prediction)
    private predictionsRepository: Repository<Prediction>,
    @InjectRepository(PredictionRecord)
    private recordsRepository: Repository<PredictionRecord>,
    private storageService: StorageService,
    private configService: ConfigService,
  ) {
    this.inferenceServiceURL =
      this.configService.get<string>('INFERENCE_SERVICE_URL') ?? '';
  }

  @Process('processPrediction')
  async handlePrediction(job: Job<{ predictionId: string }>) {
    const { predictionId } = job.data;
    const prediction = await this.predictionsRepository.findOne({
      where: { id: predictionId },
    });
    if (!prediction) {
      console.error(
        `[PredictionProcessor] error: Prediction ID ${predictionId} not found.`,
      );
      return;
    }

    console.log(`Processing Prediction ID: ${predictionId}`);
    const records = await this.recordsRepository.find({
      where: { prediction: { id: predictionId } },
      relations: ['prediction'],
    });

    const dataframe_split_data = records.map((record) => record.dfData);

    const dataframe_split: IDataframeSplitRequest = {
      dataframe_split: {
        columns: prediction.dfColumns,
        data: dataframe_split_data,
      },
    };

    // POST Generate Heatmap
    const heatmapObservable = this.httpService.post<IHeatmapResponse>(
      `${this.inferenceServiceURL}/v1/explain/heatmap/${prediction.modelName}`,
      dataframe_split,
      { headers: { Host: this.hostHeader } },
    );

    const heatmapResponse = await lastValueFrom(heatmapObservable);
    if (heatmapResponse?.data) {
      const heatmapUrl = await this.storageService.uploadToS3(
        heatmapResponse.data.explain,
        predictionId,
        `heatmap_${predictionId}.png`,
      );
      prediction.heatmap = heatmapUrl;
    }

    // POST Generate Beeswarm
    const beeswarmObservable = this.httpService.post<IBeeswarmResponse>(
      `${this.inferenceServiceURL}/v1/explain/beeswarm/${prediction.modelName}`,
      dataframe_split,
      { headers: { Host: this.hostHeader } },
    );

    const beeswarmResponse = await lastValueFrom(beeswarmObservable);
    if (beeswarmResponse?.data) {
      const beeswarmUrl = await this.storageService.uploadToS3(
        beeswarmResponse.data.explain,
        predictionId,
        `beeswarm_${predictionId}.png`,
      );
      prediction.beeswarm = beeswarmUrl;
    }

    await this.predictionsRepository.save(prediction);

    // Process Each Record for Prediction
    for (const record of records) {
      try {
        console.log(`[PredictionProcessor] processing Record ID: ${record.id}`);
        const dataframe_split: IDataframeSplitRequest = {
          dataframe_split: {
            columns: prediction.dfColumns,
            data: [record.dfData],
          },
        };

        // Prediction (Proba & Class)
        try {
          const predictionObservable = this.httpService.post<IPredictResponse>(
            `${this.inferenceServiceURL}/v1/predict/${prediction.modelName}`,
            dataframe_split,
            { headers: { Host: this.hostHeader } },
          );

          const predictionResponse = await lastValueFrom(predictionObservable);
          record.proba = parseFloat(
            predictionResponse?.data.predict[0].proba.toFixed(4),
          );
          record.class = predictionResponse?.data.predict[0].class;
        } catch (error) {
          console.error(
            `[PredictionProcessor] error: prediction API failed for Record ID ${record.id}:`,
            error.message,
          );
          record.status = PredictionStatus.ERROR;
          await this.recordsRepository.save(record);
          continue;
        }

        // POST Generate Waterfall
        try {
          const waterfallObservable = this.httpService.post<IWaterfallResponse>(
            `${this.inferenceServiceURL}/v1/explain/waterfall/${prediction.modelName}`,
            dataframe_split,
            { headers: { Host: this.hostHeader } },
          );

          const waterfallResponse = await lastValueFrom(waterfallObservable);
          if (waterfallResponse?.data) {
            const waterfallUrl = await this.storageService.uploadToS3(
              waterfallResponse.data.explain[0].waterfall,
              predictionId,
              `waterfall_${record.id}.png`,
            );
            record.waterfall = waterfallUrl;
          }
        } catch (error) {
          console.error(
            `[PredictionProcessor] error: waterfall API failed for Record ID ${record.id}:`,
            error.message,
          );
          record.status = PredictionStatus.ERROR;
          await this.recordsRepository.save(record);
          continue;
        }
        record.status = PredictionStatus.SUCCESS;
        await this.recordsRepository.save(record);
      } catch (error) {
        console.error(
          `[PredictionProcessor] error: unexpected error processing Record ID ${record.id}:`,
          error.message,
        );
        record.status = PredictionStatus.ERROR;
        await this.recordsRepository.save(record);
        continue;
      }
    }

    console.log(`✅ Prediction ID ${predictionId} processing completed.`);
  }
}
