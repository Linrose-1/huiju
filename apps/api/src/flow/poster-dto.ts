import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsInt, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator'

export class PosterCopyInput {
  @ApiProperty({ maxLength: 40 }) @IsString() @MaxLength(40) subtitle!: string
  @ApiProperty({ type: [String], maxItems: 2 }) @IsArray() @ArrayMaxSize(2) @IsString({ each: true }) @Length(1, 24, { each: true }) highlights!: string[]
  @ApiProperty() @IsString() @Matches(/^[a-f0-9]{64}$/) sourceHash!: string
  @ApiProperty() @IsInt() @Min(0) @Max(4294967294) version!: number
}

export class ActivityPosterDto {
  @ApiProperty({ type: String, nullable: true, description: '活动发起人的公开昵称' }) organizerName!: string | null
  @ApiProperty({ type: String, nullable: true }) hostOrganization!: string | null
  @ApiProperty({ type: String, nullable: true }) organizingOrganization!: string | null
  @ApiProperty({ type: String, nullable: true }) sponsorOrganization!: string | null
  @ApiProperty() activityId!: string
  @ApiProperty() title!: string
  @ApiProperty({ type: String, nullable: true }) coverUrl!: string | null
  @ApiProperty() startsAt!: string
  @ApiProperty() endsAt!: string
  @ApiProperty() location!: string
  @ApiProperty({ enum: ['free', 'paid'] }) feeType!: 'free' | 'paid'
  @ApiProperty({ type: Number, nullable: true, description: '费用，单位为分' }) feeAmount!: number | null
  @ApiProperty() sourceHash!: string
  @ApiProperty() version!: number
  @ApiProperty() subtitle!: string
  @ApiProperty({ type: [String] }) highlights!: string[]
  @ApiProperty({ enum: ['none', 'confirmed', 'stale'] }) copyStatus!: 'none' | 'confirmed' | 'stale'
  @ApiProperty() canEdit!: boolean
}
export class PosterDraftDto {
  @ApiProperty() subtitle!: string
  @ApiProperty({ type: [String] }) highlights!: string[]
  @ApiProperty() sourceHash!: string
  @ApiProperty() remainingToday!: number
}
export class PosterCodeDto {
  @ApiProperty() scene!: string
  @ApiProperty() base64!: string
  @ApiProperty({ enum: ['image/png', 'image/jpeg'] }) mimeType!: 'image/png' | 'image/jpeg'
}
export class PosterTargetDto {
  @ApiProperty() activityId!: string
  @ApiProperty() inviteCode!: string
}
