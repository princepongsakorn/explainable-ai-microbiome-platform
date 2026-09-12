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
  Headers,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
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

  /**
   * The whole Prediction's Explanation, gzipped JSON, with a conditional GET.
   *
   * No signed URL on this path: a signed URL expires inside a tab left open,
   * an ETag does not.
   */
  @Get(':predictionId/explain')
  async getExplanation(
    @Param('predictionId') predictionId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ) {
    const { key, etag } = await this.predictionsService.getExplanationRef(
      predictionId,
    );
    const quoted = `"${etag}"`;

    res.setHeader('ETag', quoted);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

    // Answered from the database read above; storage is never touched.
    if (ifNoneMatch === quoted) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Encoding', 'gzip');
    this.predictionsService.streamExplanation(key).pipe(res);
  }

  /** One Sample, sliced out of the same artifact. Never a recomputation. */
  @Get(':predictionId/records/:recordId/explain')
  async getRecordExplanation(
    @Param('predictionId') predictionId: string,
    @Param('recordId') recordId: string,
  ) {
    return this.predictionsService.sliceExplanationForRecord(
      predictionId,
      recordId,
    );
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
