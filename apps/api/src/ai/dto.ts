import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsIn, IsObject, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator'

const replyFields = ['time', 'location', 'title', 'description', 'fee', 'capacity'] as const
const periods = ['morning', 'afternoon', 'evening'] as const
export class DraftReplyContext {
  @ApiProperty({ enum: [...replyFields] }) @IsIn(replyFields) field!: typeof replyFields[number]
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string
  @ApiPropertyOptional({ enum: [...periods] }) @IsOptional() @IsIn(periods) period?: typeof periods[number]
}

export const gatherFields = ['title', 'description', 'date', 'time', 'location', 'joining', 'fee', 'amount', 'capacity', 'contact'] as const
type GatherField = typeof gatherFields[number]

class ConversationField {
  @ApiProperty({ enum: [...gatherFields] }) @IsIn(gatherFields) field!: GatherField
}

export class DraftKnownValue extends ConversationField {
  @ApiProperty({ maxLength: 500 }) @IsString() @Length(1, 500) value!: string
}

export class DraftExchange extends ConversationField {
  @ApiProperty({ maxLength: 120 }) @IsString() @Length(1, 120) prompt!: string
  @ApiProperty({ maxLength: 500 }) @IsString() @Length(1, 500) answer!: string
}

export class DraftConversation {
  @ApiProperty({ type: [DraftKnownValue], maxItems: 10 }) @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => DraftKnownValue)
  known!: DraftKnownValue[]
  @ApiProperty({ type: [DraftExchange], maxItems: 6 }) @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => DraftExchange)
  recent!: DraftExchange[]
  @ApiProperty({ enum: [...gatherFields], isArray: true, maxItems: 10 }) @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsIn(gatherFields, { each: true })
  pending!: GatherField[]
}

export class GatherQuestionDto extends ConversationField {
  @ApiProperty() prompt!: string
  @ApiProperty({ type: [String], maxItems: 4 }) options!: string[]
}

export class ActivityDraftInput {
  @ApiProperty({ minLength: 1, maxLength: 5000 }) @IsString() @Length(1, 5000) @Matches(/\S/) idea!: string
  @ApiPropertyOptional({ type: DraftReplyContext }) @IsOptional() @IsObject() @ValidateNested() @Type(() => DraftReplyContext)
  reply?: DraftReplyContext
  @ApiPropertyOptional({ type: DraftConversation }) @IsOptional() @IsObject() @ValidateNested() @Type(() => DraftConversation)
  conversation?: DraftConversation
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
  @ApiProperty({ type: GatherQuestionDto, nullable: true }) nextQuestion!: GatherQuestionDto | null
}
