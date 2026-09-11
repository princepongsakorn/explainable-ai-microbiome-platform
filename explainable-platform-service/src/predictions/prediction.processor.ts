import { lastValueFrom } from 'rxjs';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Prediction } from '../entity/prediction.entity';
import { PredictionRecord } from '../entity/prediction-record.entity';
import { StorageService } from '../storage/storage.service';
import { ConfigService } from '@nestjs/config';
import {
  IDataframeSplitRequest,
  IPredictResponse,
} from 'src/interface/prediction-api.interface';
import {
  ImageGenStatus,
  PredictionStatus,
} from 'src/interface/prediction-class.enum';
import { EventsHub } from 'src/events/events.hub';

/**
 * A real matplotlib SHAP plot of ~200 features is tens of KB. A blank/failed
 * canvas comes back ~3 KB (~4 KB once base64-encoded). Anything below this
 * many base64 characters is treated as "image generation failed".
 */
const MIN_PNG_BASE64_LEN = 8000;

type ExplainEndpoint = 'waterfall' | 'heatmap' | 'beeswarm';

interface ImageResult {
  key: string | null;
  error: ImageGenStatus | null;
}

@Processor('predictionQueue')
export class PredictionProcessor {
  private inferenceServiceURL: string;

  constructor(
    private httpService: HttpService,
    @InjectRepository(Prediction)
    private predictionsRepository: Repository<Prediction>,
    @InjectRepository(PredictionRecord)
    private recordsRepository: Repository<PredictionRecord>,
    private storageService: StorageService,
    private configService: ConfigService,
    private eventsHub: EventsHub,
  ) {
    this.inferenceServiceURL =
      this.configService.get<string>('INFERENCE_SERVICE_URL') ?? '';
  }

  // Build the FE-friendly payload once so every event emits the same shape.
  // We resolve presigned URLs here so the client can drop the data straight
  // into the table/drawer without an extra round-trip.
  private async toRecordEvent(record: PredictionRecord) {
    return {
      id: record.id,
      status: record.status,
      proba: record.proba,
      class: record.class,
      errorMsg: record.errorMsg,
      waterfall: record.waterfall
        ? await this.storageService.getPresignedUrl(record.waterfall)
        : null,
      waterfallError: record.waterfallError ?? null,
    };
  }

  private async toPredictionExplainEvent(prediction: Prediction) {
    return {
      predictionId: prediction.id,
      heatmap: prediction.heatmap
        ? await this.storageService.getPresignedUrl(prediction.heatmap)
        : null,
      heatmapError: prediction.heatmapError ?? null,
      beeswarm: prediction.beeswarm
        ? await this.storageService.getPresignedUrl(prediction.beeswarm)
        : null,
      beeswarmError: prediction.beeswarmError ?? null,
    };
  }

  /**
   * Call an /v1/explain/* endpoint, validate the returned plot, and upload it.
   *
   * Distinguishes the two failure modes the UI cares about:
   *   - inference call throws, or returns an empty/blank PNG -> IMAGE_FAILED
   *   - plot is fine but the GCS upload throws               -> UPLOAD_FAILED
   */
  private async runExplain(
    endpoint: ExplainEndpoint,
    modelName: string,
    dataframeSplit: IDataframeSplitRequest,
    extractBase64: (data: unknown) => string | undefined,
    storagePath: string,
    fileName: string,
  ): Promise<ImageResult> {
    let base64: string | undefined;
    try {
      const observable = this.httpService.post(
        `${this.inferenceServiceURL}/v1/explain/${endpoint}/${modelName}`,
        dataframeSplit,
      );
      const response = await lastValueFrom(observable);
      base64 = extractBase64(response?.data);
    } catch (error) {
      console.error(
        `[PredictionProcessor] ${endpoint} inference call failed: ${
          (error as Error)?.message
        }`,
      );
      return { key: null, error: ImageGenStatus.IMAGE_FAILED };
    }

    if (!base64 || base64.length < MIN_PNG_BASE64_LEN) {
      console.error(
        `[PredictionProcessor] ${endpoint} produced an empty/blank image ` +
          `(base64 length ${base64?.length ?? 0})`,
      );
      return { key: null, error: ImageGenStatus.IMAGE_FAILED };
    }

    try {
      const key = await this.storageService.uploadToS3(
        base64,
        storagePath,
        fileName,
      );
      return { key, error: null };
    } catch (error) {
      console.error(
        `[PredictionProcessor] ${endpoint} upload to storage failed: ${
          (error as Error)?.message
        }`,
      );
      return { key: null, error: ImageGenStatus.UPLOAD_FAILED };
    }
  }

  // ------------------------------------------------------------------
  // Prediction-level plots: heatmap + beeswarm (over all records)
  // ------------------------------------------------------------------
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

    console.log(
      `[PredictionProcessor] processing prediction ID: ${predictionId}`,
    );
    await this.generatePredictionPlots(prediction);
  }

  /**
   * Generate heatmap + beeswarm for a prediction and persist them.
   * Each plot is independent — a heatmap failure must NOT skip the beeswarm
   * (the previous code had no try/catch here, so one failing call killed
   * both plots).
   */
  private async generatePredictionPlots(
    prediction: Prediction,
    only?: 'heatmap' | 'beeswarm',
  ) {
    const records = await this.recordsRepository.find({
      where: { prediction: { id: prediction.id } },
      relations: ['prediction'],
    });
    const dataframeSplit: IDataframeSplitRequest = {
      dataframe_split: {
        columns: prediction.dfColumns,
        data: records.map((record) => record.dfData),
      },
    };

    if (!only || only === 'heatmap') {
      const heatmap = await this.runExplain(
        'heatmap',
        prediction.modelName,
        dataframeSplit,
        (data) => (data as { explain?: string })?.explain,
        prediction.id,
        `heatmap_${prediction.id}.png`,
      );
      prediction.heatmap = heatmap.key;
      prediction.heatmapError = heatmap.error;
    }

    if (!only || only === 'beeswarm') {
      const beeswarm = await this.runExplain(
        'beeswarm',
        prediction.modelName,
        dataframeSplit,
        (data) => (data as { explain?: string })?.explain,
        prediction.id,
        `beeswarm_${prediction.id}.png`,
      );
      prediction.beeswarm = beeswarm.key;
      prediction.beeswarmError = beeswarm.error;
    }

    await this.predictionsRepository.save(prediction);

    // Notify any open drawer/list that the prediction-level plots changed.
    this.eventsHub.publishPrediction(
      prediction.id,
      'prediction:explain',
      await this.toPredictionExplainEvent(prediction),
    );
    console.log(
      `[PredictionProcessor] Prediction ID ${prediction.id} plots completed.`,
    );
  }

  // ------------------------------------------------------------------
  // Record-level: prediction (proba/class) + waterfall
  // ------------------------------------------------------------------
  @Process('processPredictionRecord')
  async handlePredictionRecord(
    job: Job<{ predictionId: string; recordId: string }>,
  ) {
    const { recordId } = job.data;
    const record = await this.recordsRepository.findOne({
      where: { id: recordId },
      relations: ['prediction'],
    });

    if (!record) {
      console.error(
        `[PredictionProcessor] error: Prediction Record ID ${recordId} not found.`,
      );
      return;
    }

    try {
      console.log(`[PredictionProcessor] processing Record ID: ${record.id}`);
      record.status = PredictionStatus.IN_PROGRESS;
      await this.recordsRepository.save(record);
      this.eventsHub.publishPrediction(
        record.prediction.id,
        'record:update',
        await this.toRecordEvent(record),
      );

      const activeJob = await job.queue.getJob(job.id);
      if (!activeJob) {
        console.log(
          `[PredictionProcessor] Job was terminated for Record ID: ${record.id}`,
        );
        record.status = PredictionStatus.CANCELED;
        record.errorMsg = 'Job was terminated';
        await this.recordsRepository.save(record);
        this.eventsHub.publishPrediction(
          record.prediction.id,
          'record:update',
          await this.toRecordEvent(record),
        );
        return;
      }

      const prediction = record.prediction;
      const dataframeSplit: IDataframeSplitRequest = {
        dataframe_split: {
          columns: prediction.dfColumns,
          data: [record.dfData],
        },
      };

      // --- Prediction (proba & class) ---
      let predictionFailed = false;
      try {
        const observable = this.httpService.post<IPredictResponse>(
          `${this.inferenceServiceURL}/v1/predict/${prediction.modelName}`,
          dataframeSplit,
        );
        const response = await lastValueFrom(observable);
        const result = response?.data?.predict?.[0];
        // The service may answer 200 with a missing/empty body when it is
        // unhealthy. Treat a non-numeric result as a hard failure rather
        // than silently saving an empty record as SUCCESS.
        if (
          !result ||
          result.proba === null ||
          result.proba === undefined ||
          result.class === null ||
          result.class === undefined
        ) {
          throw new Error('Prediction service returned an empty result');
        }
        record.proba = parseFloat(Number(result.proba).toFixed(4));
        record.class = result.class;
      } catch (error) {
        predictionFailed = true;
        console.error(
          `[PredictionProcessor] error: prediction API failed for Record ID ${record.id}:`,
          (error as Error).message,
        );
        record.status = PredictionStatus.ERROR;
        record.errorMsg = (error as Error).message;
        await this.recordsRepository.save(record);
        this.eventsHub.publishPrediction(
          record.prediction.id,
          'record:update',
          await this.toRecordEvent(record),
        );
      }

      // --- Waterfall plot (only attempted when the prediction succeeded) ---
      // A waterfall failure does NOT fail the record: the prediction itself
      // is valid, the user just needs to re-generate the plot. The failure
      // is recorded in `waterfallError` so the UI can show a re-gen button.
      if (!predictionFailed) {
        const waterfall = await this.runExplain(
          'waterfall',
          prediction.modelName,
          dataframeSplit,
          (data) =>
            (data as { explain?: { waterfall?: string }[] })?.explain?.[0]
              ?.waterfall,
          prediction.id,
          `waterfall_${record.id}.png`,
        );
        record.waterfall = waterfall.key;
        record.waterfallError = waterfall.error;
      }

      // --- Final status ---
      // SUCCESS requires a real prediction result. This closes the bug where
      // a record could end up SUCCESS with empty proba/class.
      if (!predictionFailed) {
        const hasResult =
          record.proba !== null &&
          record.proba !== undefined &&
          record.class !== null &&
          record.class !== undefined;
        if (hasResult) {
          record.status = PredictionStatus.SUCCESS;
          record.errorMsg = null;
        } else {
          record.status = PredictionStatus.ERROR;
          record.errorMsg =
            'Prediction completed without a result (the inference service may have been unavailable)';
        }
        await this.recordsRepository.save(record);
      }

      this.eventsHub.publishPrediction(
        record.prediction.id,
        'record:update',
        await this.toRecordEvent(record),
      );
    } catch (error) {
      console.error(
        `[PredictionProcessor] error: unexpected error processing Record ID ${record.id}:`,
        (error as Error).message,
      );
      record.status = PredictionStatus.ERROR;
      record.errorMsg = (error as Error).message;
      await this.recordsRepository.save(record);
      this.eventsHub.publishPrediction(
        record.prediction.id,
        'record:update',
        await this.toRecordEvent(record),
      );
    }

    console.log(
      `[PredictionProcessor] Record ID ${recordId} processing completed.`,
    );
  }

  // ------------------------------------------------------------------
  // Re-generation jobs — retry a single plot without re-running the whole
  // prediction. Triggered by the /regen/* endpoints.
  // ------------------------------------------------------------------
  @Process('regenWaterfall')
  async handleRegenWaterfall(
    job: Job<{ predictionId: string; recordId: string }>,
  ) {
    const { recordId } = job.data;
    const record = await this.recordsRepository.findOne({
      where: { id: recordId },
      relations: ['prediction'],
    });
    if (!record) {
      console.error(
        `[PredictionProcessor] regenWaterfall: Record ID ${recordId} not found.`,
      );
      return;
    }

    const prediction = record.prediction;
    const dataframeSplit: IDataframeSplitRequest = {
      dataframe_split: {
        columns: prediction.dfColumns,
        data: [record.dfData],
      },
    };
    const waterfall = await this.runExplain(
      'waterfall',
      prediction.modelName,
      dataframeSplit,
      (data) =>
        (data as { explain?: { waterfall?: string }[] })?.explain?.[0]
          ?.waterfall,
      prediction.id,
      `waterfall_${record.id}.png`,
    );
    record.waterfall = waterfall.key;
    record.waterfallError = waterfall.error;
    await this.recordsRepository.save(record);
    this.eventsHub.publishPrediction(
      prediction.id,
      'record:update',
      await this.toRecordEvent(record),
    );
    console.log(
      `[PredictionProcessor] regenWaterfall completed for Record ID ${recordId}.`,
    );
  }

  @Process('regenHeatmap')
  async handleRegenHeatmap(job: Job<{ predictionId: string }>) {
    const prediction = await this.predictionsRepository.findOne({
      where: { id: job.data.predictionId },
    });
    if (!prediction) {
      console.error(
        `[PredictionProcessor] regenHeatmap: Prediction ID ${job.data.predictionId} not found.`,
      );
      return;
    }
    await this.generatePredictionPlots(prediction, 'heatmap');
  }

  @Process('regenBeeswarm')
  async handleRegenBeeswarm(job: Job<{ predictionId: string }>) {
    const prediction = await this.predictionsRepository.findOne({
      where: { id: job.data.predictionId },
    });
    if (!prediction) {
      console.error(
        `[PredictionProcessor] regenBeeswarm: Prediction ID ${job.data.predictionId} not found.`,
      );
      return;
    }
    await this.generatePredictionPlots(prediction, 'beeswarm');
  }
}
