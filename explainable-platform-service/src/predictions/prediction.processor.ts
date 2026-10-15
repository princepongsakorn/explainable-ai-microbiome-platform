import { lastValueFrom } from 'rxjs';
import { isAxiosError } from 'axios';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
import { pinnedVersionQuery, versionMismatch } from './model-version';

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
  /**
   * Whether to render the matplotlib PNGs (heatmap, beeswarm, waterfall).
   *
   * Off by default: the charts are drawn in the browser from the explanation
   * payload, and every PNG recomputed SHAP for Samples already explained. The
   * code is kept so they can be switched back on without a revert. The regen
   * endpoints still render one when asked explicitly.
   */
  private readonly generatePngPlots: boolean;

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
    this.generatePngPlots =
      this.configService.get<string>('GENERATE_PNG_PLOTS') === 'true';
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
      modelVersion: record.modelVersion ?? null,
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
    prediction: Prediction,
    dataframeSplit: IDataframeSplitRequest,
    extractBase64: (data: unknown) => string | undefined,
    storagePath: string,
    fileName: string,
  ): Promise<ImageResult> {
    let base64: string | undefined;
    try {
      const observable = this.httpService.post(
        `${this.inferenceServiceURL}/v1/explain/${endpoint}/${prediction.modelName}` +
          pinnedVersionQuery(prediction.modelVersion),
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
    // not cost the other.
    await this.buildExplanation(prediction);
    if (this.generatePngPlots) {
      await this.generatePredictionPlots(prediction);
    }
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
      // concatPayloads already refuses chunks from different versions; this
      // refuses a whole explanation from a version other than the pinned one.
      const mismatch = versionMismatch(
        prediction.modelVersion,
        joined.model_version,
        'The explanation',
      );
      if (mismatch) throw new Error(mismatch);
      const payload: ExplainPayload = {
        ...joined,
        ...sampleLabelsFor(
          records,
          prediction.dfColumns ?? [],
          joined.feature_names,
        ),
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
    const url =
      `${this.inferenceServiceURL}/v1/explain/values/${prediction.modelName}` +
      pinnedVersionQuery(prediction.modelVersion);
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
        prediction,
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
        prediction,
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

  /**
   * Predict a chunk of records with one call to the runtime.
   *
   * Every call costs the runtime about the same fixed work whatever its size
   * (1.4 s for one Sample, 2.2 s for 331 on the deployed VM), so one call per
   * record made a 331-Sample upload take minutes. Each record still gets its
   * own status, result and error.
   */
  @Process('processPredictionRecords')
  async handlePredictionRecords(
    job: Job<{ predictionId: string; recordIds: string[] }>,
  ) {
    await this.predictRecordsJob(job, job.data.recordIds);
  }

  /** One record per job: what was queued before chunking, and may still be waiting. */
  @Process('processPredictionRecord')
  async handlePredictionRecord(
    job: Job<{ predictionId: string; recordId: string }>,
  ) {
    await this.predictRecordsJob(job, [job.data.recordId]);
  }

  private async predictRecordsJob(job: Job, recordIds: string[]) {
    // Ordered so a chunk's rows, and its log lines, follow the upload.
    const records = await this.recordsRepository.find({
      where: { id: In(recordIds) },
      relations: ['prediction'],
      order: { record_number: 'ASC' },
    });

    if (records.length < recordIds.length) {
      const found = new Set(records.map((record) => record.id));
      console.error(
        `[PredictionProcessor] error: Prediction Record IDs not found: ` +
          recordIds.filter((id) => !found.has(id)).join(', '),
      );
    }
    if (records.length === 0) return;

    const prediction = records[0].prediction;
    try {
      console.log(
        `[PredictionProcessor] processing ${records.length} record(s) of prediction ${prediction.id}`,
      );
      for (const record of records) {
        record.status = PredictionStatus.IN_PROGRESS;
      }
      await this.recordsRepository.save(records);
      await this.publishRecords(prediction.id, records);

      const activeJob = await job.queue.getJob(job.id);
      if (!activeJob) {
        console.log(
          `[PredictionProcessor] Job was terminated for prediction ${prediction.id}`,
        );
        for (const record of records) {
          record.status = PredictionStatus.CANCELED;
          record.errorMsg = 'Job was terminated';
        }
        await this.recordsRepository.save(records);
        await this.publishRecords(prediction.id, records);
        return;
      }

      // --- Prediction (proba & class) ---
      await this.predictInto(prediction, records);

      // --- Waterfall plot (only when PNGs are on and the prediction succeeded) ---
      // A waterfall failure does NOT fail the record: the prediction itself
      // is valid, the user just needs to re-generate the plot. The failure
      // is recorded in `waterfallError` so the UI can show a re-gen button.
      for (const record of records) {
        if (
          !this.generatePngPlots ||
          record.status === PredictionStatus.ERROR
        ) {
          continue;
        }
        const waterfall = await this.runExplain(
          'waterfall',
          prediction,
          {
            dataframe_split: {
              columns: prediction.dfColumns,
              data: [record.dfData],
            },
          },
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
      for (const record of records) {
        if (record.status === PredictionStatus.ERROR) continue;
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
      }
      await this.recordsRepository.save(records);
      await this.publishRecords(prediction.id, records);
    } catch (error) {
      console.error(
        `[PredictionProcessor] error: unexpected error processing records of prediction ${prediction.id}:`,
        (error as Error).message,
      );
      for (const record of records) {
        record.status = PredictionStatus.ERROR;
        record.errorMsg = (error as Error).message;
      }
      await this.recordsRepository.save(records);
      await this.publishRecords(prediction.id, records);
    }

    console.log(
      `[PredictionProcessor] ${records.length} record(s) of prediction ${prediction.id} completed.`,
    );
  }

  /**
   * Ask the runtime for every record's proba and class in one call, writing
   * each answer onto its record. A record the runtime gave no usable answer
   * for is set to ERROR with the reason.
   */
  private async predictInto(
    prediction: Prediction,
    records: PredictionRecord[],
  ): Promise<void> {
    const fail = (record: PredictionRecord, message: string) => {
      record.status = PredictionStatus.ERROR;
      record.errorMsg = message;
    };

    let response: { data: IPredictResponse };
    try {
      response = await lastValueFrom(
        this.httpService.post<IPredictResponse>(
          `${this.inferenceServiceURL}/v1/predict/${prediction.modelName}` +
            pinnedVersionQuery(prediction.modelVersion),
          {
            dataframe_split: {
              columns: prediction.dfColumns,
              data: records.map((record) => record.dfData),
              // The runtime answers each row under its index, so results are
              // matched to records by id rather than by position.
              index: records.map((record) => record.id),
            },
          },
        ),
      );
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      // A 400 is the runtime refusing the input, such as a value that is not a
      // number, and one bad row refuses the whole chunk. Asking again a record
      // at a time fails only the rows that are actually bad.
      if (status === 400 && records.length > 1) {
        for (const record of records) {
          await this.predictInto(prediction, [record]);
        }
        return;
      }
      console.error(
        `[PredictionProcessor] error: prediction API failed for ${records.length} record(s) ` +
          `of prediction ${prediction.id}:`,
        (error as Error).message,
      );
      // The runtime's own words, e.g. that the pinned version is gone.
      const message = inferenceErrorMessage(error);
      for (const record of records) fail(record, message);
      return;
    }

    const modelVersion = response?.data?.model_version ?? null;
    const mismatch = versionMismatch(
      prediction.modelVersion,
      modelVersion,
      'This result',
    );
    const byId = new Map(
      (response?.data?.predict ?? []).map((result) => [
        String(result.id),
        result,
      ]),
    );
    for (const record of records) {
      record.modelVersion = modelVersion;
      if (mismatch) {
        fail(record, mismatch);
        continue;
      }
      const result = byId.get(record.id);
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
        fail(record, 'Prediction service returned an empty result');
        continue;
      }
      record.proba = parseFloat(Number(result.proba).toFixed(4));
      record.class = result.class;
    }
  }

  private async publishRecords(
    predictionId: string,
    records: PredictionRecord[],
  ) {
    for (const record of records) {
      this.eventsHub.publishPrediction(
        predictionId,
        'record:update',
        await this.toRecordEvent(record),
      );
    }
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
      prediction,
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
