import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, In, Repository } from 'typeorm';
import { Prediction } from '../entity/prediction.entity';
import { PredictionRecord } from '../entity/prediction-record.entity';
import { parseCsv } from '../utils/csv-parser.util';
import { QueueService } from '../queue/queue.service';
import { Multer } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { StorageService } from 'src/storage/storage.service';
import { PaginationMeta } from 'src/interface/pagination.interface';
import {
  PredictionClass,
  PredictionStatus,
} from 'src/interface/prediction-class.enum';
import { EventsHub } from 'src/events/events.hub';

@Injectable()
export class PredictionsService {
  constructor(
    @InjectRepository(Prediction)
    private predictionsRepository: Repository<Prediction>,
    @InjectRepository(PredictionRecord)
    private recordsRepository: Repository<PredictionRecord>,
    private readonly queueService: QueueService,
    private storageService: StorageService,
    private readonly eventsHub: EventsHub,
  ) {}

  async createPrediction(file: Multer.File, modelName: string) {
    const { dfColumns, dfDataRows } = await parseCsv(file);

    const lastPrediction = await this.predictionsRepository
      .createQueryBuilder('prediction')
      .orderBy('prediction.prediction_number', 'DESC')
      .limit(1)
      .getOne();

    const predictionNumber = lastPrediction
      ? lastPrediction.prediction_number + 1
      : 10000000;

    const predictionId = uuidv4();
    const prediction = this.predictionsRepository.create({
      id: predictionId,
      prediction_number: predictionNumber,
      modelName,
      dfColumns: dfColumns,
    });

    await this.predictionsRepository.save(prediction);
    for (const row of dfDataRows) {
      const lastRecord = await this.recordsRepository
        .createQueryBuilder('record')
        .orderBy('record.record_number', 'DESC')
        .limit(1)
        .getOne();

      const recordNumber = lastRecord ? lastRecord.record_number + 1 : 10000000;

      const recordId = uuidv4();
      const record = this.recordsRepository.create({
        id: recordId,
        record_number: recordNumber,
        prediction,
        dfData: row,
      });
      await this.recordsRepository.save(record);
    }

    await this.queueService.addPredictionJob(prediction.id);
    const records = await this.recordsRepository.find({
      where: { prediction: { id: predictionId } },
    });
    for (const record of records) {
      await this.queueService.addPredictionRecordJob(predictionId, record.id);
    }

    return { message: 'Prediction Created', predictionId: prediction.id };
  }

  async rePredictRecords(predictionId: string) {
    const failedRecords = await this.recordsRepository.find({
      where: {
        prediction: { id: predictionId },
        status: In([PredictionStatus.ERROR, PredictionStatus.CANCELED]),
      },
      order: { record_number: 'DESC' },
    });

    if (failedRecords.length === 0) {
      throw new NotFoundException('No failed records found for re-prediction.');
    }

    // Flip the records back to PENDING immediately and announce it so the FE
    // can show the new state without waiting for the worker to pick them up.
    for (const record of failedRecords) {
      record.status = PredictionStatus.PENDING;
      record.errorMsg = null;
      await this.recordsRepository.save(record);
      this.eventsHub.publishPrediction(predictionId, 'record:update', {
        id: record.id,
        status: record.status,
        proba: record.proba,
        class: record.class,
        errorMsg: record.errorMsg,
        waterfall: record.waterfall
          ? await this.storageService.getPresignedUrl(record.waterfall)
          : null,
        waterfallError: record.waterfallError ?? null,
      });
      await this.queueService.addPredictionRecordJob(predictionId, record.id);
    }

    return {
      message: `Re-prediction started for ${failedRecords.length} failed records.`,
    };
  }

  async cancelPrediction(predictionId: string) {
    await this.queueService.cancelPredictionJob(predictionId);

    // QueueService bulk-updates records to CANCELED via repository.update(),
    // which bypasses entity listeners. Re-read the affected records here so
    // we can broadcast each new state to any open SSE subscriber.
    const canceledRecords = await this.recordsRepository.find({
      where: {
        prediction: { id: predictionId },
        status: PredictionStatus.CANCELED,
      },
    });
    for (const record of canceledRecords) {
      this.eventsHub.publishPrediction(predictionId, 'record:update', {
        id: record.id,
        status: record.status,
        proba: record.proba,
        class: record.class,
        errorMsg: record.errorMsg,
        waterfall: record.waterfall
          ? await this.storageService.getPresignedUrl(record.waterfall)
          : null,
        waterfallError: record.waterfallError ?? null,
      });
    }

    return { message: `Prediction job for ${predictionId} was canceled.` };
  }

  // --- Targeted plot re-generation -------------------------------------
  // Each method validates the target exists, then enqueues a Bull job. SHAP
  // for a GCN is slow (~20s+), so we never run it inline in the HTTP request
  // — the worker handles it and pushes the result over SSE when done.
  async regenHeatmap(predictionId: string) {
    const prediction = await this.predictionsRepository.findOne({
      where: { id: predictionId },
    });
    if (!prediction) {
      throw new NotFoundException(`Prediction ID ${predictionId} not found`);
    }
    await this.queueService.addRegenHeatmapJob(predictionId);
    return { message: 'Heatmap re-generation queued.' };
  }

  async regenBeeswarm(predictionId: string) {
    const prediction = await this.predictionsRepository.findOne({
      where: { id: predictionId },
    });
    if (!prediction) {
      throw new NotFoundException(`Prediction ID ${predictionId} not found`);
    }
    await this.queueService.addRegenBeeswarmJob(predictionId);
    return { message: 'Beeswarm re-generation queued.' };
  }

  async regenWaterfall(predictionId: string, recordId: string) {
    const record = await this.recordsRepository.findOne({
      where: { id: recordId, prediction: { id: predictionId } },
    });
    if (!record) {
      throw new NotFoundException(
        `PredictionRecord ${recordId} not found for prediction ${predictionId}`,
      );
    }
    await this.queueService.addRegenWaterfallJob(predictionId, recordId);
    return { message: 'Waterfall re-generation queued.' };
  }

  async getPredictions(page: number = 1, limit: number = 10) {
    const [items, totalItems] = await this.predictionsRepository.findAndCount({
      select: [
        'id',
        'modelName',
        'heatmap',
        'heatmapError',
        'beeswarm',
        'beeswarmError',
        'createdAt',
        'prediction_number',
      ],
      take: limit,
      skip: (page - 1) * limit,
      order: { prediction_number: 'DESC' },
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
          predictionNumber: prediction.prediction_number,
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
          heatmapError: prediction.heatmapError ?? null,
          beeswarm: prediction.beeswarm
            ? await this.storageService.getPresignedUrl(prediction.beeswarm)
            : null,
          beeswarmError: prediction.beeswarmError ?? null,
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
    predictionStatus: PredictionStatus = PredictionStatus.ALL,
  ) {
    const prediction = await this.predictionsRepository.findOne({
      where: { id: predictionId },
      select: ['id', 'prediction_number', 'modelName', 'dfColumns'],
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

    if (predictionStatus === PredictionStatus.PENDING) {
      whereCondition['status'] = PredictionStatus.PENDING;
    } else if (predictionStatus === PredictionStatus.ERROR) {
      whereCondition['status'] = PredictionStatus.ERROR;
    } else if (predictionStatus === PredictionStatus.SUCCESS) {
      whereCondition['status'] = PredictionStatus.SUCCESS;
    } else if (predictionStatus === PredictionStatus.IN_PROGRESS) {
      whereCondition['status'] = PredictionStatus.IN_PROGRESS;
    } else if (predictionStatus === PredictionStatus.CANCELED) {
      whereCondition['status'] = PredictionStatus.CANCELED;
    }

    const [items, totalItems] = await this.recordsRepository
      .createQueryBuilder('record')
      .select([
        'record.id',
        'record.record_number',
        'record.proba',
        'record.class',
        'record.waterfall',
        'record.waterfallError',
        'record.status',
        'record.errorMsg',
        'record.dfData',
        'record.comment',
      ])
      .where(whereCondition)
      .orderBy(
        `
      CASE record.status
        WHEN 'SUCCESS' THEN 1
        WHEN 'IN_PROGRESS' THEN 2
        WHEN 'PENDING' THEN 3
        WHEN 'CANCELED' THEN 4
        WHEN 'ERROR' THEN 5
        ELSE 6
      END
    `,
      )
      .addOrderBy('record.record_number', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const predictions = await Promise.all(
      items.map(async (predictionRow) => {
        return {
          ...predictionRow,
          dfColumns: prediction.dfColumns,
          waterfall: predictionRow.waterfall
            ? await this.storageService.getPresignedUrl(predictionRow.waterfall)
            : null,
          waterfallError: predictionRow.waterfallError ?? null,
        };
      }),
    );

    const meta: PaginationMeta = {
      totalItems,
      itemCount: items.length,
      itemsPerPage: limit,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
    };

    return {
      items: predictions,
      prediction: {
        predictionNumber: prediction.prediction_number,
        ...prediction,
      },
      meta,
    };
  }

  async updatePredictionRecordsComment(
    predictionId: string,
    predictionRecordsId: string,
    comment: string,
  ): Promise<PredictionRecord> {
    const record = await this.recordsRepository.findOne({
      where: {
        id: predictionRecordsId,
        prediction: { id: predictionId },
      },
      relations: ['prediction'],
    });
    if (!record) {
      throw new NotFoundException(
        `PredictionRecord with id ${predictionRecordsId} not found`,
      );
    }
    record.comment = comment;
    return await this.recordsRepository.save(record);
  }
}
