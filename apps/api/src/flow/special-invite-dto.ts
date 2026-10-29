import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsIn, IsOptional, IsString, Matches } from 'class-validator'
import { PageQuery } from './pagination.js'

export const inviteStatuses = ['unused', 'used', 'expired', 'paused'] as const
export type InviteStatus = typeof inviteStatuses[number]
export class SpecialInviteCreateInput {
  @ApiProperty() @IsString() @Matches(/^1\d{10}$/) phone!: string
}
export class SpecialInviteVerifyInput {
  @ApiProperty() @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Matches(/^[A-HJ-NP-Z2-9]{12}$/) code!: string
}
export class SpecialInviteQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['all', ...inviteStatuses], default: 'all' }) @IsOptional() @IsIn(['all', ...inviteStatuses]) status: 'all' | InviteStatus = 'all'
}
export class SpecialInviteCodeDto {
  @ApiProperty() id!: string
  @ApiProperty() code!: string
  @ApiProperty() maskedPhone!: string
  @ApiProperty({ enum: inviteStatuses }) status!: InviteStatus
  @ApiProperty() createdAt!: string
  @ApiProperty() expiresAt!: string
  @ApiProperty({ type: String, nullable: true }) usedAt!: string | null
  @ApiProperty({ type: String, nullable: true }) registrationId!: string | null
}
export class SpecialInviteListDto {
  @ApiProperty({ type: [SpecialInviteCodeDto] }) items!: SpecialInviteCodeDto[]
  @ApiProperty() total!: number
  @ApiProperty() hasMore!: boolean
}
export class SpecialInviteVerifiedDto {
  @ApiProperty() valid!: boolean
  @ApiProperty() maskedPhone!: string
  @ApiProperty() expiresAt!: string
}
