import { Module } from '@nestjs/common';
import { MlflowService } from './mlflow.service';
import { MlflowController } from './mlflow.controller';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThirdPartyToken } from 'src/entity/third-party-token.entity';
import { User } from 'src/entity/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ThirdPartyToken, User]), HttpModule],
  controllers: [MlflowController],
  providers: [MlflowService],
})
export class MLflowModule {}
