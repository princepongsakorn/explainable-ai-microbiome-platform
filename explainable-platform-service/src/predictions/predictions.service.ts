import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, In, MoreThanOrEqual, Repository } from 'typeorm';
import {
  RecordCountRow,
  emptyRecordCounts,
  foldRecordCounts,
} from './record-counts';
import { Prediction } from '../entity/prediction.entity';
import { PredictionRecord } from '../entity/prediction-record.entity';
import {
  InvalidCsvError,
  parseCsv,
  toNumericRows,
} from '../utils/csv-parser.util';
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
import { gunzipSync } from 'node:zlib';
import {
  ExplainPayload,
  MAX_SAMPLES_PER_PREDICTION,
  sliceSample,
} from './explain.builder';

/**
 * Parsed payloads kept for the per-Sample route. Each is the whole matrix — up
 * to 500 x ~900 values twice over, tens of MB once parsed — so only a couple.
 */
const PARSED_PAYLOAD_CACHE_SIZE = 2;

@Injectable()
export class PredictionsService {
  /** Keyed by object key and ETag, least recently used first. */
  private readonly parsedPayloads = new Map<string, Promise<ExplainPayload>>();

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
    let dfColumns: string[];
    let dfDataRows: (string | number)[][];
    try {
      const parsed = await parseCsv(file);
      dfColumns = parsed.dfColumns;
      // Reject before anything is persisted or enqueued. Together with the row cap
      // below this is what lets the Explanation payload promise it holds no NaN
      // (docs/shap-explain-spec.md §2.1).
      dfDataRows = toNumericRows(parsed.dfColumns, parsed.dfDataRows);
    } catch (error) {
      if (error instanceof InvalidCsvError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    if (dfDataRows.length > MAX_SAMPLES_PER_PREDICTION) {
      throw new BadRequestException(
        `This file has ${dfDataRows.length} samples; the limit is ` +
          `${MAX_SAMPLES_PER_PREDICTION} per prediction. Split it and submit the ` +
          `parts separately.`,
      );
    }

    if (dfDataRows.length === 0) {
      throw new BadRequestException('The file has a header but no data rows.');
    }

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
  //
  // Before queueing, the plot field is cleared (image + error -> null). This
  // makes the in-progress state server-truth: the FE renders the spinner
  // whenever a plot has neither an image nor an error, so it survives a page
  // refresh and is correctly scoped per prediction/record (no shared flag).

  // Build + emit the prediction-level explain event (heatmap + beeswarm),
  // resolving presigned URLs so the client can render without a refetch.
  private async emitPredictionExplain(prediction: Prediction) {
    this.eventsHub.publishPrediction(prediction.id, 'prediction:explain', {
      predictionId: prediction.id,
      heatmap: prediction.heatmap
        ? await this.storageService.getPresignedUrl(prediction.heatmap)
        : null,
      heatmapError: prediction.heatmapError ?? null,
      beeswarm: prediction.beeswarm
        ? await this.storageService.getPresignedUrl(prediction.beeswarm)
        : null,
      beeswarmError: prediction.beeswarmError ?? null,
    });
  }

  async regenHeatmap(predictionId: string) {
    const prediction = await this.predictionsRepository.findOne({
      where: { id: predictionId },
    });
    if (!prediction) {
      throw new NotFoundException(`Prediction ID ${predictionId} not found`);
    }
    prediction.heatmap = null;
    prediction.heatmapError = null;
    await this.predictionsRepository.save(prediction);
    await this.emitPredictionExplain(prediction);
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
    prediction.beeswarm = null;
    prediction.beeswarmError = null;
    await this.predictionsRepository.save(prediction);
    await this.emitPredictionExplain(prediction);
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
    record.waterfall = null;
    record.waterfallError = null;
    await this.recordsRepository.save(record);
    this.eventsHub.publishPrediction(predictionId, 'record:update', {
      id: record.id,
      status: record.status,
      proba: record.proba,
      class: record.class,
      errorMsg: record.errorMsg,
      waterfall: null,
      waterfallError: null,
    });
    await this.queueService.addRegenWaterfallJob(predictionId, recordId);
    return { message: 'Waterfall re-generation queued.' };
  }

  // ------------------------------------------------------------------
  // Explanation payload — docs/shap-explain-spec.md §2.3
  // ------------------------------------------------------------------

  /**
   * The stored object's key and ETag.
   *
   * Deliberately separate from reading the object: a conditional GET is answered
   * from this alone, so a repeat load costs one database read and never touches
   * storage.
   */
  async getExplanationRef(predictionId: string) {
    const prediction = await this.predictionsRepository.findOne({
      where: { id: predictionId },
      select: ['id', 'explainKey', 'explainEtag', 'explainError'],
    });
    if (!prediction) {
      throw new NotFoundException(`Prediction ${predictionId} not found`);
    }
    if (prediction.explainError) {
      // Distinct from "not ready": the job ran and failed, and the reason is
      // what the person looking at the drawer needs to see.
      throw new UnprocessableEntityException(
        `Explanation failed: ${prediction.explainError}`,
      );
    }
    if (!prediction.explainKey || !prediction.explainEtag) {
      throw new NotFoundException('Explanation is not ready yet');
    }
    return { key: prediction.explainKey, etag: prediction.explainEtag };
  }

  /** The stored bytes, still gzipped, to be streamed through untouched. */
  streamExplanation(key: string) {
    return this.storageService.createReadStream(key);
  }

  /**
   * One Sample's Explanation, taken from the stored matrix.
   *
   * `PredictionRecord.id` is the platform's identifier and `sample_ids` is the
   * payload's; this is the only place the two vocabularies meet (CONTEXT.md).
   * Nothing is recomputed — the SHAP values were produced once for the whole
   * Prediction.
   */
  async sliceExplanationForRecord(predictionId: string, recordId: string) {
    const { key, etag } = await this.getExplanationRef(predictionId);
    const payload = await this.parsedPayload(key, etag);

    try {
      return sliceSample(payload, recordId);
    } catch (error) {
      throw new NotFoundException((error as Error).message);
    }
  }

  /**
   * The stored payload, downloaded and parsed once per version.
   *
   * Without this every record opened read and gunzipped the whole matrix again.
   * The ETag in the key means a rebuilt explanation is never served from here
   * stale, and concurrent requests for the same one share a single download.
   */
  private parsedPayload(key: string, etag: string): Promise<ExplainPayload> {
    const cacheKey = `${key}#${etag}`;
    const cached = this.parsedPayloads.get(cacheKey);
    if (cached) {
      this.parsedPayloads.delete(cacheKey);
      this.parsedPayloads.set(cacheKey, cached);
      return cached;
    }

    const loading = this.storageService
      .download(key)
      .then(
        (compressed) =>
          JSON.parse(gunzipSync(compressed).toString('utf8')) as ExplainPayload,
      );
    // A failed read is not remembered; the next request tries again.
    loading.catch(() => this.parsedPayloads.delete(cacheKey));
    this.parsedPayloads.set(cacheKey, loading);

    for (const oldest of this.parsedPayloads.keys()) {
      if (this.parsedPayloads.size <= PARSED_PAYLOAD_CACHE_SIZE) break;
      this.parsedPayloads.delete(oldest);
    }
    return loading;
  }

  /**
   * Queue a rebuild of the Explanation artifact.
   *
   * Clearing the fields first makes the in-progress state server-truth, the same
   * way the plot regeneration methods above do it.
   */
  async regenExplanation(predictionId: string) {
    const prediction = await this.predictionsRepository.findOne({
      where: { id: predictionId },
    });
    if (!prediction) {
      throw new NotFoundException(`Prediction ${predictionId} not found`);
    }

    // Every explain field, the versions included: they describe the artifact
    // being thrown away, and a rebuild that fails must not inherit them.
    await this.predictionsRepository.update(predictionId, {
      explainKey: null,
      explainEtag: null,
      explainError: null,
      explainModelVersion: null,
      explainContractVersion: null,
    });
    // An open drawer is still drawing the old explanation. Tell it now, not
    // when the rebuild finishes minutes from now.
    this.eventsHub.publishPrediction(predictionId, 'prediction:explanation', {
      ready: false,
      etag: null,
      error: null,
    });

    await this.queueService.addRegenExplanationJob(predictionId);
    return { message: `Explanation rebuild queued for ${predictionId}.` };
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

    // One grouped query for the whole page, where there were three COUNTs per
    // prediction. The relation column is quoted raw: TypeORM does not map
    // "predictionId" from a property path.
    const ids = items.map((prediction) => prediction.id);
    const countRows: RecordCountRow[] = ids.length
      ? await this.recordsRepository
          .createQueryBuilder('record')
          .select('"record"."predictionId"', 'predictionId')
          .addSelect('"record"."status"', 'status')
          .addSelect('"record"."class"', 'class')
          .addSelect('COUNT(*)', 'count')
          .where('"record"."predictionId" IN (:...ids)', { ids })
          .groupBy('"record"."predictionId"')
          .addGroupBy('"record"."status"')
          .addGroupBy('"record"."class"')
          .getRawMany()
      : [];
    const countsById = foldRecordCounts(ids, countRows);

    const predictions = await Promise.all(
      items.map(async (prediction) => {
        const predictionId = prediction.id;

        return {
          id: prediction.id,
          predictionNumber: prediction.prediction_number,
          modelName: prediction.modelName,
          records: countsById.get(predictionId) ?? emptyRecordCounts(),
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

  /** The prediction list's summary strip, counted across every prediction. */
  async getPredictionSummary() {
    const predictionsWithStatus = async (statuses: PredictionStatus[]) => {
      const row = await this.recordsRepository
        .createQueryBuilder('record')
        .select('COUNT(DISTINCT "record"."predictionId")', 'count')
        .where('"record"."status" IN (:...statuses)', { statuses })
        .getRawOne();
      return Number(row?.count ?? 0);
    };
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [inProgress, needsAttention, uploadedLast7Days] = await Promise.all([
      predictionsWithStatus([
        PredictionStatus.PENDING,
        PredictionStatus.IN_PROGRESS,
      ]),
      predictionsWithStatus([PredictionStatus.ERROR]),
      this.predictionsRepository.count({
        where: { createdAt: MoreThanOrEqual(since) },
      }),
    ]);
    return { inProgress, needsAttention, uploadedLast7Days };
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
