import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';
import { Prediction } from '../entity/prediction.entity';
import { PredictionRecord } from '../entity/prediction-record.entity';
import { PredictionProcessor } from './prediction.processor';
import { StorageService } from '../storage/storage.service';
import { QueueService } from 'src/queue/queue.service';
import { HttpModule } from '@nestjs/axios';
import { QueueModule } from 'src/queue/queue.module';
import { StorageModule } from 'src/storage/storage.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Prediction, PredictionRecord]),
    BullModule.registerQueue({ name: 'predictionQueue' }),
    HttpModule,
    QueueModule,
    StorageModule,
    ConfigModule,
  ],
  controllers: [PredictionsController],
  providers: [PredictionsService, PredictionProcessor, StorageService, QueueService],
})
export class PredictionsModule {}