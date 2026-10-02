import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator'
import { PageQuery } from '../flow/pagination.js'
export const categories = ['park', 'operation', 'service', 'store'] as const
export const subtypes = ['rent', 'sale', 'transfer', 'seek_rent', 'buy'] as const
export class CircleQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['all', ...categories], default: 'all' }) @IsOptional() @IsIn(['all', ...categories]) category: string = 'all'
}
export class CircleWriteInput {
  @ApiProperty() @IsUUID() requestId!: string
  @ApiProperty({ enum: categories }) @IsIn(categories) category!: typeof categories[number]
  @ApiPropertyOptional({ enum: subtypes, nullable: true }) @IsOptional() @IsIn(subtypes) subtype?: typeof subtypes[number] | null
  @ApiProperty() @IsString() @Length(1, 200) @Matches(/\S/) title!: string
  @ApiProperty() @IsString() @Length(1, 10000) @Matches(/\S/) body!: string
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @Length(0, 500) location?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @Length(0, 100) area?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @Length(0, 200) price?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) validUntil?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @Length(0, 200) storeName?: string | null
  @ApiProperty({ type: [String], maxItems: 6 }) @IsArray() @ArrayMaxSize(6) @ArrayUnique() @IsUUID(undefined, { each: true }) imageIds!: string[]
}
export class CircleIntentInput {
  @ApiProperty() @IsUUID() requestId!: string
  @ApiProperty() @IsString() @Length(6, 32) @Matches(/^\+?[0-9][0-9 ()-]{4,30}[0-9]$/) phone!: string
}
export class CircleReasonInput {
  @ApiProperty() @IsString() @Length(1, 1000) @Matches(/\S/) reason!: string
}
export class CircleAuthorDto {
  @ApiProperty() id!: string
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null
}
export class CircleImageDto { @ApiProperty() id!: string; @ApiProperty() url!: string }
export class CirclePostDto {
  @ApiProperty() id!: string
  @ApiProperty({ enum: categories }) category!: string
  @ApiProperty({ type: String, nullable: true }) subtype!: string | null
  @ApiProperty() title!: string
  @ApiProperty() body!: string
  @ApiProperty({ type: String, nullable: true }) location!: string | null
  @ApiProperty({ type: String, nullable: true }) area!: string | null
  @ApiProperty({ type: String, nullable: true }) price!: string | null
  @ApiProperty({ type: String, nullable: true }) validUntil!: string | null
  @ApiProperty({ type: String, nullable: true }) storeName!: string | null
  @ApiProperty({ enum: ['open', 'ended', 'removed'] }) state!: string
  @ApiProperty() isOwner!: boolean
  @ApiProperty({ type: CircleAuthorDto, nullable: true }) author!: CircleAuthorDto | null
  @ApiProperty({ type: [CircleImageDto] }) images!: CircleImageDto[]
  @ApiProperty({ type: String, nullable: true }) removalReason!: string | null
  @ApiProperty() createdAt!: string
}
export class CircleListDto { @ApiProperty({ type: [CirclePostDto] }) items!: CirclePostDto[]; @ApiProperty() hasMore!: boolean }
export class CircleIntentDto {
  @ApiProperty() id!: string
  @ApiProperty({ type: CircleAuthorDto }) member!: CircleAuthorDto
  @ApiProperty() phone!: string
  @ApiProperty() createdAt!: string
}
export class CircleIntentListDto { @ApiProperty({ type: [CircleIntentDto] }) items!: CircleIntentDto[]; @ApiProperty() hasMore!: boolean }
export class CircleOperationDto {
  @ApiProperty() id!: string
  @ApiProperty() action!: string
  @ApiProperty() reason!: string
  @ApiProperty({ type: String, nullable: true }) actorName!: string | null
  @ApiProperty() createdAt!: string
}
export class CircleHistoryDto { @ApiProperty({ type: [CircleOperationDto] }) items!: CircleOperationDto[]; @ApiProperty() hasMore!: boolean }
