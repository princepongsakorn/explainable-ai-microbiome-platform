import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';
import { Prediction } from '../models/prediction.entity';
import { PredictionRecord } from '../models/prediction-record.entity';
import { PredictionProcessor } from './prediction.processor';
import { StorageService } from '../storage/storage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Prediction, PredictionRecord]),
    BullModule.registerQueue({ name: 'predictionQueue' }),
  ],
  controllers: [PredictionsController],
  providers: [PredictionsService, PredictionProcessor, StorageService],
})
export class PredictionsModule {}