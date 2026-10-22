import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectVersion } from './project-version.entity';
import { Project } from './project.entity';
import { ProjectsController, SharedController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectVersion])],
  controllers: [ProjectsController, SharedController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
