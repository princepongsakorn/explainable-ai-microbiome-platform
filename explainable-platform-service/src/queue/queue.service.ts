import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PredictionRecord } from 'src/entity/prediction-record.entity';
import { PredictionStatus } from 'src/interface/prediction-class.enum';

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

  async addPredictionRecordJob(predictionId: string, recordId: string) {
    await this.predictionQueue.add('processPredictionRecord', {
      predictionId,
      recordId,
    });
  }

  async cancelPredictionJob(predictionId: string) {
    const jobs: Job[] = await this.predictionQueue.getJobs([
      'active',
      'waiting',
    ]);

    for (const job of jobs) {
      const jobData = job.data as { predictionId: string; recordId?: string };
      if (jobData.predictionId === predictionId && jobData.recordId) {
        await job.remove();
        console.log(
          `[QueueService] Canceled Job: ${job.id} (PredictionID: ${predictionId}, RecordID: ${jobData.recordId || 'ALL'})`,
        );
      }
    }

    await this.recordsRepository
      .createQueryBuilder()
      .update(PredictionRecord)
      .set({ status: PredictionStatus.ERROR, errorMsg: 'Job was terminated' })
      .where('predictionId = :predictionId AND status IN (:...statuses)', {
        predictionId,
        statuses: [PredictionStatus.PENDING, PredictionStatus.IN_PROGRESS],
      })
      .execute();
  }
}
