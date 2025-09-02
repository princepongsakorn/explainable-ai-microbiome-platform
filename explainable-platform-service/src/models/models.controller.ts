import { Controller, Get, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { ModelsService } from './models.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { ModelType } from 'src/entity/model-type.entity';

@Controller('models')
@UseGuards(JwtAuthGuard)
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  async getModels() {
    try {
      return await this.modelsService.fetchProductionModels();
    } catch (error) {
      throw new HttpException('Failed to fetch models', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('/model-type')
  async getModelTypes(): Promise<ModelType[]> {
    return this.modelsService.fetchAllModelTypes();
  }
}