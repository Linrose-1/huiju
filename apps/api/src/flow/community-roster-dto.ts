import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean } from 'class-validator'

export class CommunityAccessDto {
  @ApiProperty() isAdmin!: boolean
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
  @ApiProperty({ type: [CommunityRosterMemberDto] }) items!: CommunityRosterMemberDto[]
  @ApiProperty() total!: number
}

export class CommunityRecognitionInput {
  @ApiProperty() @IsBoolean() isRegistered!: boolean
}
