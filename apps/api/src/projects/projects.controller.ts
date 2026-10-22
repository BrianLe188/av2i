import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CurrentUser, Public } from '../auth/decorators';
import { CreateProjectDto, CreateVersionDto, UpdateProjectDto } from './dto';
import type { User } from '../auth/user.entity';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.service.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateProjectDto) {
    return this.service.create(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user.id, id);
  }

  @Put(':id')
  update(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(user.id, id);
  }

  @Post(':id/share')
  share(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.enableShare(user.id, id);
  }

  @Delete(':id/share')
  @HttpCode(204)
  unshare(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.disableShare(user.id, id);
  }

  @Get(':id/export')
  export(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.export(user.id, id);
  }

  @Get(':id/versions')
  versions(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listVersions(user.id, id);
  }

  @Post(':id/versions')
  snapshot(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateVersionDto) {
    return this.service.snapshot(user.id, id, dto.label);
  }

  @Post(':id/versions/:versionId/restore')
  restore(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.service.restore(user.id, id, versionId);
  }
}

/** Read-only access by share token; no sign-in required. */
@Controller('shared')
export class SharedController {
  constructor(private readonly service: ProjectsService) {}

  @Public()
  @Get(':token')
  get(@Param('token') token: string) {
    return this.service.getShared(token);
  }
}
