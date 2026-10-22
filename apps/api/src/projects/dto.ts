import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { REGIONS, type Graph } from '@av2i/core';

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsIn(REGIONS)
  region?: string;

  @IsOptional()
  @IsObject()
  graph?: Graph;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(REGIONS)
  region?: string;

  @IsOptional()
  @IsObject()
  graph?: Graph;
}

export class CreateVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}
