import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'
import { ReaderDto } from './reading-dto.js'

export class CommentInput {
  @ApiProperty({ maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(2000)
  content!: string
}

export class ReviewInput extends CommentInput {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt() @Min(1) @Max(5)
  score!: number
}

export class CommentDto {
  @ApiProperty() id!: string
  @ApiProperty() activityId!: string
  @ApiProperty({ type: ReaderDto }) member!: ReaderDto
  @ApiProperty() content!: string
  @ApiProperty() createdAt!: string
  @ApiProperty() updatedAt!: string
  @ApiProperty() hidden!: boolean
}

export class ReviewDto extends CommentDto {
  @ApiProperty() score!: number
}

export class CommentListDto {
  @ApiProperty({ type: [CommentDto] }) items!: CommentDto[]
  @ApiProperty() total!: number
  @ApiProperty() hasMore!: boolean
}

export class ReviewListDto {
  @ApiProperty({ type: [ReviewDto] }) items!: ReviewDto[]
  @ApiProperty() total!: number
  @ApiProperty() hasMore!: boolean
}

export class FeedbackContextDto {
  @ApiProperty() canComment!: boolean
  @ApiProperty({ type: String, nullable: true }) commentReason!: string | null
  @ApiProperty() canReview!: boolean
  @ApiProperty({ type: String, nullable: true }) reviewReason!: string | null
  @ApiProperty({ type: ReviewDto, nullable: true }) myReview!: ReviewDto | null
  @ApiProperty() isOrganizer!: boolean
}

export class ReviewStatsDto {
  @ApiProperty() count!: number
  @ApiProperty({ type: Number, nullable: true }) averageScore!: number | null
}
