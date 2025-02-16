import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Prediction } from '../entity/prediction.entity';
import { PredictionRecord, PredictionStatus } from '../entity/prediction-record.entity';
import { parseCsv } from '../utils/csv-parser.util';
import { QueueService } from '../queue/queue.service';
import { Multer } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { StorageService } from 'src/storage/storage.service';

@Injectable()
export class PredictionsService {
  constructor(
    @InjectRepository(Prediction)
    private predictionsRepository: Repository<Prediction>,
    @InjectRepository(PredictionRecord)
    private recordsRepository: Repository<PredictionRecord>,
    private readonly queueService: QueueService,
    private storageService: StorageService,
  ) {}

  async createPrediction(file: Multer.File, modelName: string) {
    const { dfColumns, dfDataRows } = await parseCsv(file);
    const predictionId = uuidv4();
    const prediction = this.predictionsRepository.create({
      id: predictionId,
      modelName,
      dfColumns: dfColumns,
    });
    await this.predictionsRepository.save(prediction);

    for (const row of dfDataRows) {
      const recordId = uuidv4();
      const record = this.recordsRepository.create({
        id: recordId,
        prediction,
        dfData: row,
      });
      await this.recordsRepository.save(record);
    }

    await this.queueService.addPredictionJob(prediction.id);

    return { message: 'Prediction Created', predictionId: prediction.id };
  }

  async getPredictions() {
    const predictions = await this.predictionsRepository.find({
      select: ['id', 'modelName', 'heatmap', 'beeswarm', 'createdAt'],
    });

    return Promise.all(
      predictions.map(async (prediction) => {
        const predictionId = prediction.id
        const totalRecords = await this.recordsRepository.count({
          where: { prediction: { id: predictionId } },
        });
        const successRecords = await this.recordsRepository.count({
          where: {
            prediction: { id: predictionId },
            status: PredictionStatus.SUCCESS,
          },
        });
        const errorRecords = await this.recordsRepository.count({
          where: {
            prediction: { id: predictionId },
            status: PredictionStatus.ERROR,
          },
        });

        return {
          id: prediction.id,
          modelName: prediction.modelName,
          records: {
            total: totalRecords,
            success: successRecords,
            error: errorRecords
          },
          createdAt: prediction.createdAt,
          heatmap: prediction.heatmap
            ? await this.storageService.getPresignedUrl(prediction.heatmap)
            : null,
          beeswarm: prediction.beeswarm
            ? await this.storageService.getPresignedUrl(prediction.beeswarm)
            : null,
        };
      }),
    );
  }

  async getPredictionRecords(
    predictionId: string,
    page: number,
    limit: number,
  ) {
    const prediction = await this.predictionsRepository.findOne({
      where: { id: predictionId },
    });
    if (!prediction)
      throw new NotFoundException(`Prediction ID ${predictionId} not found`);

    const [records, total] = await this.recordsRepository.findAndCount({
      where: { prediction: { id: predictionId } },
      select: ['id', 'proba', 'class', 'waterfall'],
      take: limit,
      skip: (page - 1) * limit,
    });

    return {
      totalRecords: total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: records,
    };
  }
}
