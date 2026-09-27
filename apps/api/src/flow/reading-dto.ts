import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'

export class RecordViewInput {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  eventId!: string

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  visitorId!: string
}

export class ReadersQuery {
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 1000000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  offset = 0
}

export class ReaderDto {
  @ApiProperty({ format: 'uuid' })
  memberId!: string

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null

  @ApiProperty()
  displayName!: string
}

export class ReadingListDto {
  @ApiProperty({ type: [ReaderDto] })
  items!: ReaderDto[]

  @ApiProperty()
  total!: number

  @ApiProperty()
  hasMore!: boolean
}

export class ReadingStatsDto {
  @ApiProperty()
  views!: number

  @ApiProperty()
  visitors!: number

  @ApiProperty({ type: Number, nullable: true, description: '当前有效报名人数 / 去重浏览人数 × 100；无浏览时为 null' })
  conversionRate!: number | null
}
