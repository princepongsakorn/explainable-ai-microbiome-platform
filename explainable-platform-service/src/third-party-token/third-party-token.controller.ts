import { Controller, Post, Get, Req, Param, UseGuards } from '@nestjs/common';
import { ThirdPartyTokenService } from './third-party-token.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('third-party-token')
@UseGuards(JwtAuthGuard)
export class ThirdPartyTokenController {
  constructor(private readonly tokenService: ThirdPartyTokenService) {}

  @Post(':provider')
  async createOrUpdateToken(@Req() req, @Param('provider') provider: string) {
    const userId = req.user.userId;
    return this.tokenService.generateToken(userId, provider);
  }

  @Get(':provider')
  async getToken(@Req() req, @Param('provider') provider: string) {
    const userId = req.user.userId;
    return this.tokenService.getToken(userId, provider);
  }
}
