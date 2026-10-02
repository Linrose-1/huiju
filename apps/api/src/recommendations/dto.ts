import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator'

export class ActivitySearchInput {
  @ApiProperty() @IsUUID() requestId!: string
  @ApiProperty({ type: [String], minItems: 1, maxItems: 12 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12)
  @IsString({ each: true }) @Length(1, 2000, { each: true }) @Matches(/\S/, { each: true }) messages!: string[]
}
export class SearchPageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 256) cursor?: string
}
export class SearchImpressionsInput {
  @ApiProperty({ type: [String], maxItems: 3 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ArrayUnique() @IsUUID(undefined, { each: true }) activityIds!: string[]
}
export class SearchViewInput { @ApiProperty() @IsUUID() activityId!: string }
export class SearchViewDto { @ApiProperty({ type: String, nullable: true }) sourceToken!: string | null }
export class ActivityRecommendationDto {
  @ApiProperty() id!: string
  @ApiProperty() title!: string
  @ApiProperty() location!: string
  @ApiProperty() startsAt!: string
  @ApiProperty() endsAt!: string
  @ApiProperty({ type: String, nullable: true }) coverUrl!: string | null
  @ApiProperty({ enum: ['free', 'paid'] }) feeType!: 'free' | 'paid'
  @ApiProperty({ type: Number, nullable: true }) feeAmountCents!: number | null
  @ApiProperty() reason!: string
  @ApiProperty({ type: [String] }) differences!: string[]
}
export class ActivitySearchResultDto {
  @ApiProperty({ enum: ['results', 'clarify'] }) status!: 'results' | 'clarify'
  @ApiProperty({ type: String, nullable: true }) searchId!: string | null
  @ApiProperty({ type: [String] }) conditions!: string[]
  @ApiProperty({ type: String, nullable: true }) question!: string | null
  @ApiProperty({ type: [ActivityRecommendationDto] }) items!: ActivityRecommendationDto[]
  @ApiProperty({ type: String, nullable: true }) cursor!: string | null
  @ApiProperty() hasMore!: boolean
  @ApiProperty() remainingToday!: number
  @ApiProperty({ type: String, nullable: true }) expiresAt!: string | null
}
