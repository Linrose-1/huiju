import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsString, IsUUID, Length } from 'class-validator'

export class CommunityRouteParams {
  @ApiProperty({ minLength: 1, maxLength: 32 }) @IsString() @Length(1, 32) communityId!: string
}

export class CommunityMemberRouteParams extends CommunityRouteParams {
  @ApiProperty({ format: 'uuid' }) @IsUUID() memberId!: string
}

export class CommunityPermissionsInput {
  @ApiProperty() @IsBoolean() canViewRoster!: boolean
  @ApiProperty() @IsBoolean() canRecognizeMembers!: boolean
}

export class CommunityPermissionDto extends CommunityPermissionsInput {
  @ApiProperty() communityId!: string
  @ApiProperty() communityName!: string
}

export class CommunityPermissionListDto {
  @ApiProperty({ type: [CommunityPermissionDto] }) items!: CommunityPermissionDto[]
  @ApiProperty() total!: number
  @ApiProperty() hasMore!: boolean
}

export class CommunityAccessDto {
  @ApiProperty() isAdmin!: boolean
  @ApiProperty() canViewRoster!: boolean
  @ApiProperty() canRecognizeMembers!: boolean
  @ApiProperty() isRegistered!: boolean
}

export class CommunityRosterMemberDto {
  @ApiProperty() memberId!: string
  @ApiProperty() userNumber!: string
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null
  @ApiProperty() isRegistered!: boolean
}

export class CommunityRosterDto {
  @ApiProperty() canRecognizeMembers!: boolean
  @ApiProperty({ type: [CommunityRosterMemberDto] }) items!: CommunityRosterMemberDto[]
  @ApiProperty() total!: number
}

export class CommunityRecognitionInput {
  @ApiProperty() @IsBoolean() isRegistered!: boolean
}
