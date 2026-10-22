import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { User } from './user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Project])],
  controllers: [AuthController],
  providers: [AuthService, SessionService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
