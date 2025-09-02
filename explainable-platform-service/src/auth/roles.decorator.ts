import { SetMetadata } from '@nestjs/common';
import { UserRole } from 'src/interface/user.interface';

export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);
