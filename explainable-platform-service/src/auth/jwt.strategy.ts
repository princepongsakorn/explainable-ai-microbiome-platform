import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';
import * as jwt from 'jsonwebtoken';
import { jwtSecret } from './jwt-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtSecret(),
      passReqToCallback: true,
    });
  }

  /**
   * Rejects tokens revoked at logout, then returns the user that the guarded
   * route sees as `req.user`. With passReqToCallback set, passport hands this
   * method the request, so `payload` is the request here.
   */
  async validate(payload: any) {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(payload);
    if (this.authService.isTokenBlacklisted(token)) {
      throw new UnauthorizedException('Token is invalidated');
    }
    if (token) {
      try {
        const decoded = jwt.verify(
          token,
          jwtSecret(),
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
