import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'

export class ModerationQuery {
  @ApiPropertyOptional({ enum: ['comment', 'review'], default: 'comment' })
  @IsIn(['comment', 'review']) kind: 'comment' | 'review' = 'comment'

  @ApiPropertyOptional({ enum: ['visible', 'hidden', 'all'], default: 'visible' })
  @IsIn(['visible', 'hidden', 'all']) status: 'visible' | 'hidden' | 'all' = 'visible'

  @ApiPropertyOptional({ type: Number, default: 0, minimum: 0, maximum: 100000 })
  @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0
}

export class HideFeedbackInput {
  @ApiProperty({ maxLength: 500 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(500) reason!: string
}

export class ModerationItemDto {
  @ApiProperty() id!: string
  @ApiProperty({ enum: ['comment', 'review'] }) kind!: 'comment' | 'review'
  @ApiProperty() activityId!: string
  @ApiProperty() activityTitle!: string
  @ApiProperty() memberName!: string
  @ApiProperty() content!: string
  @ApiProperty({ type: Number, nullable: true }) score!: number | null
  @ApiProperty() createdAt!: string
  @ApiProperty({ type: String, nullable: true }) hiddenAt!: string | null
  @ApiProperty({ type: String, nullable: true }) hiddenReason!: string | null
  @ApiProperty({ type: String, nullable: true }) hiddenBy!: string | null
}

export class ModerationListDto {
  @ApiProperty({ type: [ModerationItemDto] }) items!: ModerationItemDto[]
  @ApiProperty() total!: number
  @ApiProperty() hasMore!: boolean
}
