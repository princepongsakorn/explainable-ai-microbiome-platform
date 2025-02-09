import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ModelsService } from './models.service';

@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  async getModels() {
    try {
      return await this.modelsService.fetchModels();
    } catch (error) {
      throw new HttpException('Failed to fetch models', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}