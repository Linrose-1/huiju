import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'

export class AnalyticsQuery {
  @ApiPropertyOptional({ type: Number, enum: [7, 30], default: 30 }) @Type(() => Number) @IsIn([7, 30]) days: 7 | 30 = 30
}
export class AnalyticsMemberQuery extends AnalyticsQuery {
  @ApiPropertyOptional({ type: Number, default: 0 }) @Type(() => Number) @IsInt() @Min(0) @Max(1000000) offset: number = 0
  @ApiPropertyOptional({ enum: ['all', 'new', 'converted', 'browse', 'participate', 'register', 'attend', 'publish', 'comment', 'review', 'inactive', 'silent'] })
  @IsIn(['all', 'new', 'converted', 'browse', 'participate', 'register', 'attend', 'publish', 'comment', 'review', 'inactive', 'silent']) behavior = 'all'
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() inviterId?: string
  @ApiPropertyOptional({ enum: ['all', 'complete', 'incomplete'] }) @IsIn(['all', 'complete', 'incomplete']) profile = 'all'
}
export class AnalyticsMetricDto {
  @ApiProperty() key!: string
  @ApiProperty() current!: number
  @ApiProperty() previous!: number
  @ApiProperty() delta!: number
  @ApiProperty({ type: Number, nullable: true }) changePercent!: number | null
}
export class AnalyticsTrendDto {
  @ApiProperty() date!: string
  @ApiProperty() newMembers!: number
  @ApiProperty() browsingMembers!: number
  @ApiProperty() participatingMembers!: number
}
export class AnalyticsBehaviorDto {
  @ApiProperty() behavior!: string
  @ApiProperty() members!: number
  @ApiProperty() count!: number
}
export class AnalyticsDashboardDto {
  @ApiProperty() days!: number
  @ApiProperty() startDate!: string
  @ApiProperty() endDate!: string
  @ApiProperty({ type: [AnalyticsMetricDto] }) metrics!: AnalyticsMetricDto[]
  @ApiProperty({ type: [AnalyticsTrendDto] }) trend!: AnalyticsTrendDto[]
  @ApiProperty({ type: [AnalyticsBehaviorDto] }) behaviors!: AnalyticsBehaviorDto[]
  @ApiProperty({ type: [String] }) coverageNotes!: string[]
}
export class AnalyticsMemberDto {
  @ApiProperty() id!: string
  @ApiProperty() memberNumber!: string
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null
  @ApiProperty() profileComplete!: boolean
  @ApiProperty() browse!: number
  @ApiProperty() register!: number
  @ApiProperty() attend!: number
  @ApiProperty() publish!: number
  @ApiProperty() comment!: number
  @ApiProperty() review!: number
  @ApiProperty({ type: String, nullable: true }) lastActiveAt!: string | null
}
export class AnalyticsMemberListDto {
  @ApiProperty({ type: [AnalyticsMemberDto] }) items!: AnalyticsMemberDto[]
  @ApiProperty() total!: number
  @ApiProperty() hasMore!: boolean
}
export class AnalyticsEventDto {
  @ApiProperty() behavior!: string
  @ApiProperty() activityId!: string
  @ApiProperty() activityTitle!: string
  @ApiProperty() occurredAt!: string
}
export class AnalyticsEventListDto {
  @ApiProperty({ type: [AnalyticsEventDto] }) items!: AnalyticsEventDto[]
  @ApiProperty() hasMore!: boolean
}
