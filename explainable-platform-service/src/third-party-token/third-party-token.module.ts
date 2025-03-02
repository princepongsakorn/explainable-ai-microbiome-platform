import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThirdPartyToken } from '../entity/third-party-token.entity';
import { ThirdPartyTokenService } from './third-party-token.service';
import { ThirdPartyTokenController } from './third-party-token.controller';
import { User } from '../entity/user.entity';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [TypeOrmModule.forFeature([ThirdPartyToken, User]), HttpModule],
  providers: [ThirdPartyTokenService],
  controllers: [ThirdPartyTokenController],
})
export class ThirdPartyTokenModule {}
