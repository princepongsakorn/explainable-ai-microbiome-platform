import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QueueService } from './queue.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PredictionRecord } from '../entity/prediction-record.entity';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'predictionQueue' }),
    TypeOrmModule.forFeature([PredictionRecord]),
  ],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
