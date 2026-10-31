import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator'
import { ActivityDto, ActivityCountsDto, PublicMemberDto, RegistrationDto } from './dto.js'
import type { DescriptionDelta } from './activity-description.js'
import { DescriptionDeltaDto } from './activity-description-dto.js'

export class CoverUploadDto {
  @ApiProperty() coverUrl!: string
}

export class ActivityQuestionHistoryItemDto {
  @ApiProperty() prompt!: string
  @ApiProperty({ enum: ['short_text', 'long_text', 'single', 'multiple'] })
  type!: 'short_text' | 'long_text' | 'single' | 'multiple'
  @ApiProperty({ type: [String], nullable: true }) options!: string[] | null
}
export class ActivityQuestionHistoryDto {
  @ApiProperty({ type: [ActivityQuestionHistoryItemDto] }) items!: ActivityQuestionHistoryItemDto[]
  @ApiProperty() hasMore!: boolean
}

export class QuestionWriteInput {
  @ApiPropertyOptional() @IsOptional() @IsUUID() id?: string
  @ApiProperty({ enum: ['short_text', 'long_text', 'single', 'multiple'] })
  @IsIn(['short_text', 'long_text', 'single', 'multiple']) type!: 'short_text' | 'long_text' | 'single' | 'multiple'
  @ApiProperty() @IsString() @Length(1, 1000) @Matches(/\S/) prompt!: string
  @ApiProperty() @IsBoolean() required!: boolean
  @ApiPropertyOptional({ default: false, description: '仅有效报名会员可见；已有报名后只能关闭' }) @ValidateIf((_object, value) => value !== undefined) @IsBoolean() publicToParticipants?: boolean
  @ApiPropertyOptional({ type: [String], nullable: true }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @Length(1, 200, { each: true }) options?: string[] | null
}
export class ActivityWriteInput {
  @ApiProperty() @IsString() @Length(1, 200) @Matches(/\S/) title!: string
  @ApiProperty() @IsString() @Length(1, 10000) @Matches(/\S/) description!: string
  @ApiPropertyOptional({ type: DescriptionDeltaDto, nullable: true }) @IsOptional() @IsObject() descriptionDelta?: DescriptionDelta | null
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @Length(0, 500) registrationNotice?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @Length(1, 2048) coverUrl?: string | null
  @ApiPropertyOptional({ type: [String], maxItems: 3, description: '有序活动图片，第一张为5:4封面；省略时保留已有图片，空数组清空' })
  @ValidateIf((_object, value) => value !== undefined) @IsArray() @ArrayMaxSize(3) @ArrayUnique() @IsString({ each: true }) @Length(1, 2048, { each: true }) imageUrls?: string[]
  @ApiPropertyOptional({ type: String, nullable: true, description: '本人上传的封面原图，用于再次裁剪；清空封面时同步清空' }) @IsOptional() @IsString() @Length(1, 2048) coverSourceUrl?: string | null
  @ApiProperty() @IsString() @Length(1, 500) @Matches(/\S/) location!: string
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: -90, maximum: 90, description: '微信地图 GCJ-02 纬度，与经度成对提供或清空' }) @IsOptional() @IsNumber() @Min(-90) @Max(90) locationLatitude?: number | null
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: -180, maximum: 180, description: '微信地图 GCJ-02 经度，与纬度成对提供或清空' }) @IsOptional() @IsNumber() @Min(-180) @Max(180) locationLongitude?: number | null
  @ApiProperty() @IsString() @Length(1, 1000) @Matches(/\S/) consultationContact!: string
  @ApiProperty() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) startsAt!: string
  @ApiProperty() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) endsAt!: string
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) registrationDeadline?: string | null
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsInt() @Min(1) @Max(4294967295) capacity?: number | null
  @ApiProperty({ enum: ['free', 'paid'] }) @IsIn(['free', 'paid']) feeType!: 'free' | 'paid'
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsInt() @Min(1) @Max(4294967295) feeAmountCents?: number | null
  @ApiProperty({ type: [QuestionWriteInput] }) @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => QuestionWriteInput) questions!: QuestionWriteInput[]
}
export class CancelActivityInput {
  @ApiProperty() @IsString() @Length(1, 1000) @Matches(/\S/) reason!: string
}
export class ManagedActivityDto extends ActivityDto {
  @ApiProperty({ type: String, nullable: true }) coverSourceUrl!: string | null
  @ApiProperty({ enum: ['draft', 'published', 'cancelled'] }) lifecycle!: string
  @ApiProperty({ enum: ['normal', 'removed'] }) moderation!: string
  @ApiProperty() hasRegistrationEver!: boolean
  @ApiProperty() declare consultationContact: string
}
export class ManagedActivityListDto {
  @ApiProperty({ type: ActivityCountsDto }) counts!: ActivityCountsDto
  @ApiProperty() total!: number
  @ApiProperty({ type: [ManagedActivityDto] }) items!: ManagedActivityDto[]
  @ApiProperty() hasMore!: boolean
}
export class OrganizerRegistrationDto extends RegistrationDto {
  @ApiProperty({ type: PublicMemberDto }) member!: PublicMemberDto
  @ApiProperty() attended!: boolean
  @ApiProperty({ type: String, nullable: true }) attendedAt!: string | null
}
export class AttendanceDto {
  @ApiProperty() registrationId!: string
  @ApiProperty() attended!: boolean
  @ApiProperty() attendedAt!: string
}
export class OrganizerRosterDto {
  @ApiProperty({ type: [OrganizerRegistrationDto] }) items!: OrganizerRegistrationDto[]
  @ApiProperty() hasMore!: boolean
  @ApiProperty() total!: number
  @ApiProperty() activeCount!: number
  @ApiProperty() cancelledCount!: number
  @ApiProperty() attendedCount!: number
}
export class NotificationDto {
  @ApiProperty() id!: string
  @ApiProperty({ type: String, nullable: true }) activityId!: string | null
  @ApiProperty({ enum: ['activity_cancelled', 'activity_removed', 'activity_restored', 'consultation_contact_updated'] }) type!: string
  @ApiProperty() title!: string
  @ApiProperty() body!: string
  @ApiProperty({ type: String, nullable: true }) readAt!: string | null
  @ApiProperty() createdAt!: string
}
export class NotificationListDto {
  @ApiProperty() total!: number
  @ApiProperty() unreadCount!: number
  @ApiProperty({ type: [NotificationDto] }) items!: NotificationDto[]
  @ApiProperty() hasMore!: boolean
}
