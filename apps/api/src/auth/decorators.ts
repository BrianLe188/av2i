import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from './user.entity';

export const IS_PUBLIC = 'isPublic';
/** Opt a route out of the global auth guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthedRequest = Request & { user: User };

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest<AuthedRequest>().user,
);
