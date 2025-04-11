import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ExperimentsService } from './experiments.service';
import { ModelStage } from 'src/interface/experiments.interface';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('experiments')
@UseGuards(JwtAuthGuard)
export class ExperimentsController {
  constructor(private readonly experimentsService: ExperimentsService) {}

  @Get()
  async fetchExperiments() {
    try {
      return await this.experimentsService.fetchExperiments();
    } catch (error) {
      throw new HttpException(
        'Failed to fetch experiments',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('/models')
  async fetchModel() {
    try {
      return await this.experimentsService.getRegisteredModel();
    } catch (error) {
      throw new HttpException(
        'Failed to fetch experiments',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':experimentId/')
  async getExperimentById(
    @Param('experimentId') experimentId: string,
    @Query('orderBy') orderBy: string,
    @Query('pageToken') pageToken: string,
  ) {
    try {
      return await this.experimentsService.getExperimentById(
        experimentId,
        orderBy,
        pageToken,
      );
    } catch (error) {
      throw new HttpException(
        'Failed to fetch experiments by id',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('description/:experimentId/')
  async updateDescriptionExperiments(
    @Param('experimentId') experimentId: string,
    @Body('description') description: string,
  ) {
    try {
      return await this.experimentsService.postUpdateDescriptionExperiments(
        experimentId,
        description,
      );
    } catch (error) {
      throw new HttpException(
        'Failed to update description experiments',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('run/:runId/')
  async getRunById(@Param('runId') runId: string) {
    try {
      return await this.experimentsService.getRunById(runId);
    } catch (error) {
      throw new HttpException(
        'Failed to fetch run by id',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('run/publish-model/:runId/')
  async putPublishModelByRunId(@Param('runId') runId: string) {
    try {
      return await this.experimentsService.putUpdateModelById(
        runId,
        ModelStage.Production,
      );
    } catch (error) {
      throw new HttpException(
        'Failed to publish model by id',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('run/unpublish-model/:runId/')
  async putUnPublishModelByRunId(@Param('runId') runId: string) {
    try {
      return await this.experimentsService.putUpdateModelById(
        runId,
        ModelStage.None,
      );
    } catch (error) {
      throw new HttpException(
        'Failed to unpublish model by id',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
