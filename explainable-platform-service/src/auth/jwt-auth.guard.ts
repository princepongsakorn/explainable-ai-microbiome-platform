import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  Inject,
  Scope,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { lastValueFrom, Observable } from 'rxjs';

@Injectable({ scope: Scope.REQUEST }) 
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.split(' ')[1];
    if (token && this.authService.isTokenBlacklisted(token)) {
      throw new UnauthorizedException(
        'Token has been invalidated. Please log in again.',
      );
    }
    const canActivateResult = super.canActivate(context);
    if (canActivateResult instanceof Observable) {
      return lastValueFrom(canActivateResult);
    }
    return canActivateResult as boolean;
  }
}
