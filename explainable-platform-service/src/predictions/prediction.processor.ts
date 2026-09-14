import { lastValueFrom } from 'rxjs';
import { isAxiosError } from 'axios';
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
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  ExplainPayload,
  chunkIndices,
  concatPayloads,
  sampleLabelsFor,
} from './explain.builder';

/**
 * A real matplotlib SHAP plot of ~200 features is tens of KB. A blank/failed
 * canvas comes back ~3 KB (~4 KB once base64-encoded). Anything below this
 * many base64 characters is treated as "image generation failed".
 */
const MIN_PNG_BASE64_LEN = 8000;

/** Attempts per explain chunk before the whole Explanation is abandoned. */
const EXPLAIN_CHUNK_ATTEMPTS = 3;
const EXPLAIN_RETRY_BASE_MS = 1000;
/**
 * The PNG endpoints receive every Sample in one call, so they can outlast the
 * module's 120 s timeout, which is sized for one explain chunk.
 */
const PLOT_TIMEOUT_MS = 900_000;

/** The runtime's own message when it sent one, rather than axios's "status code 400". */
function inferenceErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const detail = (error.response?.data as { error?: unknown } | undefined)
      ?.error;
    if (typeof detail === 'string' && detail) return detail;
  }
  return (error as Error)?.message ?? String(error);
}

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
        { timeout: PLOT_TIMEOUT_MS },
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

    // The Explanation payload and the PNGs are independent: a failure in one must
    // not cost the other. The PNGs stay until every chart has shipped, because
    // they are the visual reference the new charts are checked against.
    await this.buildExplanation(prediction);
    await this.generatePredictionPlots(prediction);
  }

  // ------------------------------------------------------------------
  // Explanation payload — docs/shap-explain-spec.md §2.2
  // ------------------------------------------------------------------

  /**
   * Compute the Explanation for a whole Prediction and store it as one gzipped
   * JSON object.
   *
   * The Python endpoint is called with CHUNK_SIZE Samples at a time so no single
   * HTTP call is long enough to be a problem, and a failure retries one slice
   * rather than the whole matrix. Concatenating is sound because a Sample's SHAP
   * values do not depend on which other Samples shared its request.
   */
  private async buildExplanation(prediction: Prediction) {
    // Ordered explicitly: sample_ids are positional, so an unordered fetch would
    // silently shuffle which row belongs to which record.
    const records = await this.recordsRepository.find({
      where: { prediction: { id: prediction.id } },
      order: { record_number: 'ASC' },
    });

    if (records.length === 0) {
      console.warn(
        `[PredictionProcessor] prediction ${prediction.id} has no records; skipping explanation`,
      );
      return;
    }

    try {
      const ranges = chunkIndices(records.length);
      const chunks: ExplainPayload[] = [];

      for (const [start, end] of ranges) {
        chunks.push(
          await this.explainChunk(prediction, records.slice(start, end)),
        );
        this.eventsHub.publishPrediction(
          prediction.id,
          'prediction:explanation-progress',
          { done: end, total: records.length },
        );
      }

      // Labels are what a person reads; sample_ids stay the record UUIDs every
      // join relies on. The records were fetched in record_number order above,
      // so the labels line up with the payload's rows by position.
      const joined = concatPayloads(chunks);
      const payload: ExplainPayload = {
        ...joined,
        ...sampleLabelsFor(records, prediction.dfColumns ?? [], joined.feature_names),
      };
      const raw = Buffer.from(JSON.stringify(payload), 'utf8');
      const etag = createHash('sha256').update(raw).digest('hex');

      prediction.explainKey = await this.storageService.uploadJsonGzip(
        gzipSync(raw),
        prediction.id,
        'explain.json.gz',
      );
      prediction.explainEtag = etag;
      prediction.explainContractVersion = payload.contract_version;
      prediction.explainModelVersion = payload.model_version ?? null;
      prediction.explainError = null;

      console.log(
        `[PredictionProcessor] explanation for ${prediction.id}: ` +
          `${payload.values.length} samples x ${payload.feature_names.length} features, ` +
          `${(raw.length / 1024).toFixed(0)} KiB raw`,
      );
    } catch (error) {
      prediction.explainKey = null;
      prediction.explainEtag = null;
      prediction.explainError = inferenceErrorMessage(error);
      console.error(
        `[PredictionProcessor] explanation for ${prediction.id} failed`,
        error,
      );
    }

    // Only the explanation's own columns. This runs for minutes, and saving the
    // whole entity loaded at the start would put back plot fields that another
    // job has written in the meantime.
    await this.predictionsRepository.update(prediction.id, {
      explainKey: prediction.explainKey,
      explainEtag: prediction.explainEtag,
      explainError: prediction.explainError,
      explainModelVersion: prediction.explainModelVersion,
      explainContractVersion: prediction.explainContractVersion,
    });
    this.eventsHub.publishPrediction(prediction.id, 'prediction:explanation', {
      ready: Boolean(prediction.explainKey),
      etag: prediction.explainEtag ?? null,
      error: prediction.explainError ?? null,
    });
  }

  /** One chunk of Samples, retried independently with exponential backoff. */
  private async explainChunk(
    prediction: Prediction,
    records: PredictionRecord[],
  ): Promise<ExplainPayload> {
    const url = `${this.inferenceServiceURL}/v1/explain/values/${prediction.modelName}`;
    const body: IDataframeSplitRequest = {
      dataframe_split: {
        columns: prediction.dfColumns,
        data: records.map((record) => record.dfData),
        index: records.map((record) => record.id),
      },
    };

    let lastError: unknown;
    for (let attempt = 0; attempt < EXPLAIN_CHUNK_ATTEMPTS; attempt++) {
      try {
        const response = await lastValueFrom(this.httpService.post(url, body));
        return response.data as ExplainPayload;
      } catch (error) {
        lastError = error;
        const status = isAxiosError(error) ? error.response?.status : undefined;
        // A 4xx is the runtime's verdict on the request itself, and the same body
        // gets the same verdict, so only server and network failures are retried.
        const retryable = status === undefined || status >= 500;
        const isLast = !retryable || attempt === EXPLAIN_CHUNK_ATTEMPTS - 1;
        console.warn(
          `[PredictionProcessor] explain chunk of ${records.length} failed ` +
            `(attempt ${attempt + 1}/${EXPLAIN_CHUNK_ATTEMPTS}` +
            (status ? `, HTTP ${status}` : '') +
            ')' +
            (isLast ? '' : ', retrying'),
        );
        if (isLast) break;
        await new Promise((resolve) =>
          setTimeout(resolve, EXPLAIN_RETRY_BASE_MS * 2 ** attempt),
        );
      }
    }
    throw lastError;
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

  /**
   * Recompute the Explanation for a Prediction that does not have one.
   *
   * Predictions created before this pipeline existed have no artifact, and the
   * SHAP values do not depend on anything that has changed since — so they can be
   * backfilled rather than re-uploaded.
   */
  @Process('regenExplanation')
  async handleRegenExplanation(job: Job<{ predictionId: string }>) {
    const { predictionId } = job.data;
    const prediction = await this.predictionsRepository.findOne({
      where: { id: predictionId },
    });
    if (!prediction) {
      console.error(
        `[PredictionProcessor] regenExplanation: prediction ${predictionId} not found.`,
      );
      return;
    }
    await this.buildExplanation(prediction);
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
