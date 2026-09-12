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
    // Axios defaults to timeout: 0 — no timeout at all. 120 s bounds one
    // CHUNK_SIZE-sample explain call; nothing in this service should hang forever.
    HttpModule.register({ timeout: 120_000, maxRedirects: 0 }),
    QueueModule,
    StorageModule,
    ConfigModule,
  ],
  controllers: [PredictionsController],
  providers: [PredictionsService, PredictionProcessor, StorageService, QueueService],
})
export class PredictionsModule {}