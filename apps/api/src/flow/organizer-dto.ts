import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator'
import { ActivityDto, PublicMemberDto, RegistrationDto } from './dto.js'

export class CoverUploadDto {
  @ApiProperty() coverUrl!: string
}

export class QuestionWriteInput {
  @ApiPropertyOptional() @IsOptional() @IsUUID() id?: string
  @ApiProperty({ enum: ['short_text', 'long_text', 'single', 'multiple'] })
  @IsIn(['short_text', 'long_text', 'single', 'multiple']) type!: 'short_text' | 'long_text' | 'single' | 'multiple'
  @ApiProperty() @IsString() @Length(1, 1000) @Matches(/\S/) prompt!: string
  @ApiProperty() @IsBoolean() required!: boolean
  @ApiPropertyOptional({ type: [String], nullable: true }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @Length(1, 200, { each: true }) options?: string[] | null
}
export class ActivityWriteInput {
  @ApiProperty() @IsString() @Length(1, 200) @Matches(/\S/) title!: string
  @ApiProperty() @IsString() @Length(1, 10000) @Matches(/\S/) description!: string
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @Length(1, 2048) coverUrl?: string | null
  @ApiProperty() @IsString() @Length(1, 500) @Matches(/\S/) location!: string
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
  @ApiProperty({ enum: ['draft', 'published', 'cancelled'] }) lifecycle!: string
  @ApiProperty({ enum: ['normal', 'removed'] }) moderation!: string
  @ApiProperty() hasRegistrationEver!: boolean
  @ApiProperty() declare consultationContact: string
}
export class ManagedActivityListDto {
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
export class OrganizerRosterDto { @ApiProperty({ type: [OrganizerRegistrationDto] }) items!: OrganizerRegistrationDto[] }
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
  @ApiProperty() unreadCount!: number
  @ApiProperty({ type: [NotificationDto] }) items!: NotificationDto[]
  @ApiProperty() hasMore!: boolean
}
