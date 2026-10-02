import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator'

export class AdminActivityQuery {
  @ApiPropertyOptional({ enum: ['all', 'normal', 'removed'], default: 'all' })
  @IsIn(['all', 'normal', 'removed']) status: 'all' | 'normal' | 'removed' = 'all'
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @Length(0, 100)
  q?: string
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 1000000 })
  @Type(() => Number) @IsInt() @Min(0) @Max(1000000) offset: number = 0
}
export class ActivityModerationInput {
  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 1000) reason!: string
}
export class AdminActivityDto {
  @ApiProperty() id!: string
  @ApiProperty() title!: string
  @ApiProperty() description!: string
  @ApiProperty() location!: string
  @ApiProperty({ type: String, nullable: true }) organizerName!: string | null
  @ApiProperty() startsAt!: string
  @ApiProperty() endsAt!: string
  @ApiProperty({ enum: ['published', 'cancelled'] }) lifecycle!: string
  @ApiProperty({ enum: ['normal', 'removed'] }) moderation!: string
  @ApiProperty() activeRegistrationCount!: number
  @ApiProperty({ enum: ['free', 'paid'] }) feeType!: string
  @ApiProperty({ type: Number, nullable: true }) feeAmountCents!: number | null
}
export class AdminActivityListDto {
  @ApiProperty({ type: [AdminActivityDto] }) items!: AdminActivityDto[]
  @ApiProperty() total!: number
  @ApiProperty() hasMore!: boolean
}
export class ActivityModerationOperationDto {
  @ApiProperty() id!: string
  @ApiProperty({ enum: ['remove', 'restore'] }) action!: string
  @ApiProperty({ type: String, nullable: true }) actorName!: string | null
  @ApiProperty({ type: String, nullable: true }) reason!: string | null
  @ApiProperty() createdAt!: string
}
export class ActivityModerationHistoryDto {
  @ApiProperty({ type: [ActivityModerationOperationDto] }) items!: ActivityModerationOperationDto[]
  @ApiProperty() hasMore!: boolean
}
