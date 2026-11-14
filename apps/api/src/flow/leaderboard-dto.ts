import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn } from 'class-validator'

export class LeaderboardQuery {
  @ApiPropertyOptional({ enum: ['month', 'all'], default: 'month' })
  @IsIn(['month', 'all'])
  period: 'month' | 'all' = 'month'

  @ApiPropertyOptional({ enum: ['attendance', 'organized'], default: 'attendance' })
  @IsIn(['attendance', 'organized'])
  kind: 'attendance' | 'organized' = 'attendance'
}

export class LeaderboardEntryDto {
  @ApiProperty() memberId!: string
  @ApiProperty() displayName!: string
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null
  @ApiProperty({ minimum: 1 }) count!: number
}

export class LeaderboardDto {
  @ApiProperty({ type: [LeaderboardEntryDto], maxItems: 20 }) items!: LeaderboardEntryDto[]
  @ApiProperty({ type: String, nullable: true, description: '北京时间的 YYYY-MM，累计榜为 null' })
  month!: string | null
}
