import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { PredictionsModule } from './predictions/predictions.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { ModelsModule } from './models/models.module';
import { PredictionRecord } from './entity/prediction-record.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: true,
    }),
    TypeOrmModule.forFeature([PredictionRecord]),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
      },
    }),
    ModelsModule,
    PredictionsModule,
    QueueModule,
    StorageModule,
  ],
})
export class AppModule {}
