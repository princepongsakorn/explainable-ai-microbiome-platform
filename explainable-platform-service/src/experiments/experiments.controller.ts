import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import { ExperimentsService } from './experiments.service';

@Controller('experiments')
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
}
