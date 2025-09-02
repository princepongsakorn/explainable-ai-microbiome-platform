import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';
import * as jwt from 'jsonwebtoken';
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: 'default_secret',
      passReqToCallback: true,
    });
  }

  async validate(payload: any) {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(payload);
    if (this.authService.isTokenBlacklisted(token)) {
      throw new UnauthorizedException('Token is invalidated');
    }
    if (token) {
      try {
        const decoded = jwt.verify(
          token,
          process.env.JWT_SECRET || 'default_secret',
        ) as {
          username: string;
          sub: string;
          role: string;
          iat: number;
          exp: number;
        };
        return {
          userId: decoded.sub,
          username: decoded.username,
          role: decoded.role,
        };
      } catch (error) {
        console.error('[JwtStrategy] failed:', error.message);
        throw new UnauthorizedException('Invalid token payload');
      }
    } else {
      throw new UnauthorizedException('Token is invalidated');
    }
  }
}
