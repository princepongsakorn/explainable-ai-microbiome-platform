import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  Body,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PredictionsService } from './predictions.service';
import { Multer } from 'multer';
import { PredictionClass, PredictionStatus } from 'src/interface/prediction-class.enum';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('predict')
@UseGuards(JwtAuthGuard)
export class PredictionsController {
  constructor(private readonly predictionsService: PredictionsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async createPrediction(
    @UploadedFile() file: Multer.File,
    @Body('modelName') modelName: string,
  ) {
    return this.predictionsService.createPrediction(file, modelName);
  }

  @Post(':predictionId/re-predict')
  async rePredictRecords(@Param('predictionId') predictionId: string) {
    return this.predictionsService.rePredictRecords(predictionId);
  }

  @Post(':predictionId/cancel')
  async cancelPrediction(@Param('predictionId') predictionId: string) {
    return this.predictionsService.cancelPrediction(predictionId);
  }

  @Get()
  async getPredictions(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.predictionsService.getPredictions(Number(page), Number(limit));
  }

  @Get(':predictionId/records')
  async getPredictionRecords(
    @Param('predictionId') predictionId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('class') predictionClass: PredictionClass = PredictionClass.ALL,
    @Query('status') predictionStatus: PredictionStatus = PredictionStatus.ALL,
  ) {
    return this.predictionsService.getPredictionRecords(
      predictionId,
      Number(page),
      Number(limit),
      predictionClass,
      predictionStatus
    );
  }
}
