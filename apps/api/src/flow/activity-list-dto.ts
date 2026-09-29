import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export class ActivityListQuery {
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 1000000 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000)
  offset = 0

  @ApiPropertyOptional({ enum: ['latest', 'upcoming'], default: 'latest' })
  @IsOptional() @IsIn(['latest', 'upcoming'])
  sort: 'latest' | 'upcoming' = 'latest'

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional() @IsString() @MaxLength(100)
  q?: string
}
