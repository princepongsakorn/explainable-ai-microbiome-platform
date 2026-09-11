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
  Patch,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PredictionsService } from './predictions.service';
import { Multer } from 'multer';
import {
  PredictionClass,
  PredictionStatus,
} from 'src/interface/prediction-class.enum';
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

  // --- Re-generate a single SHAP plot (without re-running the prediction) ---
  @Post(':predictionId/regen/heatmap')
  async regenHeatmap(@Param('predictionId') predictionId: string) {
    return this.predictionsService.regenHeatmap(predictionId);
  }

  @Post(':predictionId/regen/beeswarm')
  async regenBeeswarm(@Param('predictionId') predictionId: string) {
    return this.predictionsService.regenBeeswarm(predictionId);
  }

  @Post(':predictionId/records/:recordId/regen/waterfall')
  async regenWaterfall(
    @Param('predictionId') predictionId: string,
    @Param('recordId') recordId: string,
  ) {
    return this.predictionsService.regenWaterfall(predictionId, recordId);
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
      predictionStatus,
    );
  }

  @Patch(':predictionId/records/:predictionRecordsId/comment')
  async updateComment(
    @Param('predictionId') predictionId: string,
    @Param('predictionRecordsId') predictionRecordsId: string,
    @Body('comment') comment: string,
  ) {
    return await this.predictionsService.updatePredictionRecordsComment(
      predictionId,
      predictionRecordsId,
      comment,
    );
  }
}
