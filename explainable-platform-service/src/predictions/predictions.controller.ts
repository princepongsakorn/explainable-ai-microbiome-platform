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
  Logger,
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
  private readonly logger = new Logger(PredictionsController.name);

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

  @Post(':predictionId/regen/explain')
  async regenExplanation(@Param('predictionId') predictionId: string) {
    return this.predictionsService.regenExplanation(predictionId);
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

  /** Figures for the prediction list's summary strip, across every prediction. */
  @Get('summary')
  async getPredictionSummary() {
    return this.predictionsService.getPredictionSummary();
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
    const { key, etag } =
      await this.predictionsService.getExplanationRef(predictionId);
    const quoted = `"${etag}"`;

    res.setHeader('ETag', quoted);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

    // Answered from the database read above; storage is never touched.
    if (ifNoneMatch === quoted) {
      return res.status(304).end();
    }

    const stream = this.predictionsService.streamExplanation(key);
    // An 'error' with no listener is thrown, which would take the whole service
    // down over one unreadable object. Before the first byte there is still a
    // response to send; after it, only the connection is left to close.
    stream.once('error', (error) => {
      this.logger.error(`reading explanation ${key} failed: ${error.message}`);
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      res.removeHeader('Content-Encoding');
      res.removeHeader('ETag');
      res.status(500).json({
        statusCode: 500,
        message: 'The stored explanation could not be read.',
      });
    });
    // Stop reading from storage when the browser goes away mid-download.
    res.once('close', () => stream.destroy());

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Encoding', 'gzip');
    stream.pipe(res);
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
