import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PredictionRecord } from 'src/entity/prediction-record.entity';
import { PredictionStatus } from 'src/interface/prediction-class.enum';
import { chunkIndices } from 'src/predictions/explain.builder';

/**
 * Records predicted per runtime call. The runtime's cost per call is mostly
 * fixed, so this mainly sets how often a running Prediction reports progress.
 */
export const PREDICT_CHUNK_SIZE = 50;

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue('predictionQueue') private predictionQueue: Queue,
    @InjectRepository(PredictionRecord)
    private recordsRepository: Repository<PredictionRecord>,
  ) {}

  async addPredictionJob(predictionId: string) {
    await this.predictionQueue.add('processPrediction', { predictionId });
  }

  /** Queues the records in chunks of PREDICT_CHUNK_SIZE, in the order given. */
  async addPredictionRecordJobs(predictionId: string, recordIds: string[]) {
    for (const [start, end] of chunkIndices(
      recordIds.length,
      PREDICT_CHUNK_SIZE,
    )) {
      await this.predictionQueue.add('processPredictionRecords', {
        predictionId,
        recordIds: recordIds.slice(start, end),
      });
    }
  }

  // --- Targeted plot re-generation (without re-running the prediction) ---
  async addRegenWaterfallJob(predictionId: string, recordId: string) {
    await this.predictionQueue.add('regenWaterfall', {
      predictionId,
      recordId,
    });
  }

  async addRegenHeatmapJob(predictionId: string) {
    await this.predictionQueue.add('regenHeatmap', { predictionId });
  }

  async addRegenBeeswarmJob(predictionId: string) {
    await this.predictionQueue.add('regenBeeswarm', { predictionId });
  }

  async addRegenExplanationJob(predictionId: string) {
    await this.predictionQueue.add('regenExplanation', { predictionId });
  }

  /**
   * Removes a Prediction's record jobs that have not finished yet, then
   * marks every record still pending or in progress as cancelled. A job a
   * worker is already running can still finish and write its result.
   */
  async cancelPredictionJob(predictionId: string) {
    const jobs: Job[] = await this.predictionQueue.getJobs([
      'active',
      'waiting',
      'delayed',
    ]);

    for (const job of jobs) {
      const jobData = job.data as {
        predictionId: string;
        recordId?: string;
        recordIds?: string[];
      };
      if (
        jobData.predictionId === predictionId &&
        (jobData.recordId || jobData.recordIds)
      ) {
        try {
          const jobInstance = await this.predictionQueue.getJob(job.id);
          if (!jobInstance) {
            console.warn(
              `[QueueService] cancelPredictionJob: Job ${job.id} does not exist.`,
            );
            continue;
          }

          const isActive = await jobInstance.isActive();
          const isWaiting = await jobInstance.isWaiting();
          const isDelayed = await jobInstance.isDelayed();

          if (isActive || isWaiting || isDelayed) {
            await jobInstance.remove();
            console.log(
              `[QueueService] cancelPredictionJob: Canceled Job: ${job.id} (PredictionID: ${predictionId}, records: ${jobData.recordIds?.length ?? 1})`,
            );
          } else {
            console.warn(
              `[QueueService] cancelPredictionJob: ${job.id} is already completed or failed.`,
            );
          }
        } catch (error) {
          console.error(
            `[QueueService] cancelPredictionJob: error removing job ${job.id}:`,
            (error as Error).message,
          );
        }
      }
    }

    await this.recordsRepository.update(
      {
        prediction: { id: predictionId },
        status: In([PredictionStatus.PENDING, PredictionStatus.IN_PROGRESS]),
      },
      { status: PredictionStatus.CANCELED, errorMsg: 'Job was canceled' },
    );
  }
}
