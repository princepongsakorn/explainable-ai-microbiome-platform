import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class QueueService {
  constructor(@InjectQueue('predictionQueue') private predictionQueue: Queue) {}

  async addPredictionJob(predictionId: string) {
    await this.predictionQueue.add('processPrediction', { predictionId });
  }
}