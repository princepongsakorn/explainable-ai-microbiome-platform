import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MlflowService } from './mlflow.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('mlflow')
@UseGuards(JwtAuthGuard)
export class MlflowController {
  constructor(private readonly mlflowService: MlflowService) {}
  @Get('tracking_uri')
  async getMLURI() {
    try {
      return await this.mlflowService.getMLURI();
    } catch (error) {
      throw new HttpException(
        'Failed to fetch ml tracking_uri',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('token')
  async createOrUpdateToken(@Req() req) {
    const userId = req.user.userId;
    return this.mlflowService.generateToken(userId, 'mlflow');
  }

  @Get('token')
  @UseGuards(JwtAuthGuard)
  async getToken(@Req() req) {
    const userId = req.user.userId;
    return this.mlflowService.getToken(userId, 'mlflow');
  }
}
