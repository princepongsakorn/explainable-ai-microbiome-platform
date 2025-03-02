import { Module } from '@nestjs/common';
import { MlflowService } from './mlflow.service';
import { MlflowController } from './mlflow.controller';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  controllers: [MlflowController],
  providers: [MlflowService],
})
export class ExperimentsModule {}
