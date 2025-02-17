import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { Prediction } from '../entity/prediction.entity';
import {
  PredictionRecord,
} from '../entity/prediction-record.entity';
import { parseCsv } from '../utils/csv-parser.util';
import { QueueService } from '../queue/queue.service';
import { Multer } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { StorageService } from 'src/storage/storage.service';
import { PaginationMeta } from 'src/interface/pagination.interface';
import { PredictionClass, PredictionStatus } from 'src/interface/prediction-class.enum';

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

  async getPredictions(page: number = 1, limit: number = 10) {
    const [items, totalItems] = await this.predictionsRepository.findAndCount({
      select: ['id', 'modelName', 'heatmap', 'beeswarm', 'createdAt'],
      take: limit,
      skip: (page - 1) * limit,
      order: { createdAt: 'DESC' },
    });

    const predictions = await Promise.all(
      items.map(async (prediction) => {
        const predictionId = prediction.id;
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
            error: errorRecords,
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

    const meta: PaginationMeta = {
      totalItems,
      itemCount: predictions.length,
      itemsPerPage: limit,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
    };
    return { items: predictions, meta };
  }

  async getPredictionRecords(
    predictionId: string,
    page: number = 1,
    limit: number = 10,
    predictionClass: PredictionClass = PredictionClass.ALL,
  ) {
    const prediction = await this.predictionsRepository.findOne({
      where: { id: predictionId },
    });
    if (!prediction)
      throw new NotFoundException(`Prediction ID ${predictionId} not found`);

    const whereCondition: FindManyOptions<PredictionRecord>['where'] = {
      prediction: { id: predictionId },
    };

    if (predictionClass === PredictionClass.POSITIVE) {
      whereCondition['class'] = 1;
    } else if (predictionClass === PredictionClass.NEGATIVE) {
      whereCondition['class'] = 0;
    }

    const [items, totalItems] = await this.recordsRepository.findAndCount({
      where: whereCondition,
      select: ['id', 'proba', 'class', 'waterfall', 'status'],
      take: limit,
      skip: (page - 1) * limit,
    });

    const meta: PaginationMeta = {
      totalItems,
      itemCount: items.length,
      itemsPerPage: limit,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
    };

    return { items, meta };
  }
}
