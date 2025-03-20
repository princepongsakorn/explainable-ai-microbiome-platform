import { Injectable, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import {
  IExperimentResponse,
  IExperimentsRunResponse,
  IRunResponse,
  ModelStage,
} from 'src/interface/experiments.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { ThirdPartyToken } from 'src/entity/third-party-token.entity';
import { Repository } from 'typeorm';
import { User } from 'src/entity/user.entity';

@Injectable()
export class MlflowService {
  private inferenceServiceURL: string;
  private hostHeader = 'kserve-custom-inference-service.default.example.com';

  constructor(
    @InjectRepository(ThirdPartyToken)
    private tokenRepository: Repository<ThirdPartyToken>,
    @InjectRepository(User) private userRepository: Repository<User>,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.inferenceServiceURL =
      this.configService.get<string>('INFERENCE_SERVICE_URL') ?? '';
  }

  async getMLURI() {
    try {
      const response = await lastValueFrom(
        this.httpService.get<{ url: string }>(
          `${this.inferenceServiceURL}/v1/mlflow/tracking_uri`,
          { headers: { Host: this.hostHeader } },
        ),
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch ml tracking_uri`, error);
      throw error;
    }
  }

  generateRandomString(length: number = 40): string {
    const characters =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }
    return result;
  }

  maskString(
    input: string,
    visibleStart: number = 4,
    visibleEnd: number = 4,
  ): string {
    if (input.length <= visibleStart + visibleEnd) {
      return input;
    }

    const start = input.substring(0, visibleStart);
    const end = input.substring(input.length - visibleEnd);
    const masked = '*'.repeat(input.length - visibleStart - visibleEnd);

    return `${start}${masked}${end}`;
  }

  async generateToken(
    userId: string,
    provider: string,
  ): Promise<{ user: string; token?: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    try {
      const token = this.generateRandomString(40);
      const response = await lastValueFrom(
        this.httpService.post(
          `${this.inferenceServiceURL}/v1/mlflow/user`,
          {
            username: user.id,
            password: token,
          },
          {
            headers: { Host: this.hostHeader },
          },
        ),
      );
      let thirdPartyToken = await this.tokenRepository.findOne({
        where: { user: { id: userId }, provider },
      });

      if (thirdPartyToken) {
        thirdPartyToken.token = this.maskString(token);
      } else {
        thirdPartyToken = this.tokenRepository.create({
          user,
          provider,
          token: token,
        });
      }

      await this.tokenRepository.save(thirdPartyToken);
      return { user: user.id, token: token };
    } catch (error) {
      console.error(`Failed to generateToken`, error);
      throw error;
    }
  }

  async getToken(
    userId: string,
    provider: string,
  ): Promise<{ user: string; token?: string }> {
    const thirdPartyToken = await this.tokenRepository.findOne({
      where: { user: { id: userId }, provider },
    });

    if (!thirdPartyToken) {
      return { user: userId, token: undefined };
    }

    return { user: userId, token: thirdPartyToken.token };
  }
}
