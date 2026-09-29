import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length, Matches } from 'class-validator'

export class ActivityDraftInput {
  @ApiProperty({ minLength: 1, maxLength: 5000 }) @IsString() @Length(1, 5000) @Matches(/\S/) idea!: string
}

export class DraftQuestionDto {
  @ApiProperty() prompt!: string
  @ApiProperty({ enum: ['short_text', 'long_text', 'single', 'multiple'], nullable: true }) type!: 'short_text' | 'long_text' | 'single' | 'multiple' | null
  @ApiProperty({ type: Boolean, nullable: true }) required!: boolean | null
  @ApiProperty({ type: [String], nullable: true }) options!: string[] | null
}

export class ActivityDraftDto {
  @ApiProperty({ type: String, nullable: true }) title!: string | null
  @ApiProperty({ type: String, nullable: true }) description!: string | null
  @ApiProperty({ type: String, nullable: true }) startsAt!: string | null
  @ApiProperty({ type: String, nullable: true }) endsAt!: string | null
  @ApiProperty({ type: String, nullable: true }) location!: string | null
  @ApiProperty({ type: Number, nullable: true }) capacity!: number | null
  @ApiProperty({ enum: ['free', 'paid'], nullable: true }) feeType!: 'free' | 'paid' | null
  @ApiProperty({ type: Number, nullable: true }) feeAmountCents!: number | null
  @ApiProperty({ type: String, nullable: true }) registrationDeadline!: string | null
  @ApiProperty({ type: [DraftQuestionDto] }) questions!: DraftQuestionDto[]
}

export class ActivityDraftResultDto {
  @ApiProperty({ type: ActivityDraftDto }) draft!: ActivityDraftDto
  @ApiProperty({ type: [String] }) missingFields!: string[]
  @ApiProperty() remainingToday!: number
}
