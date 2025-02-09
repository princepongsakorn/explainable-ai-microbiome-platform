import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PredictionsService } from './predictions.service';
import { Multer } from 'multer';

@Controller('predict')
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

  @Get()
  async getPredictions() {
    return this.predictionsService.getPredictions();
  }

  @Get(':predictionId/records')
  async getPredictionRecords(
    @Param('predictionId') predictionId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.predictionsService.getPredictionRecords(predictionId, page, limit);
  }
}
