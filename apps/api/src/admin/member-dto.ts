import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator'

export class AdminMemberQuery {
  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsOptional() @IsString() @MaxLength(100) q?: string
  @ApiPropertyOptional({ type: Number, default: 0, minimum: 0, maximum: 100000 })
  @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() inviterId?: string
  @ApiPropertyOptional({ enum: ['all', 'complete', 'incomplete'], default: 'all' })
  @IsIn(['all', 'complete', 'incomplete']) profile: 'all' | 'complete' | 'incomplete' = 'all'
}
export class AdminMemberSummaryDto {
  @ApiProperty() id!: string
  @ApiProperty() memberNumber!: string
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null
  @ApiProperty({ type: String, nullable: true }) realName!: string | null
  @ApiProperty({ type: String, nullable: true }) boundPhone!: string | null
  @ApiProperty() profileComplete!: boolean
  @ApiProperty() createdAt!: string
}
export class AdminMemberRelationDto {
  @ApiProperty() id!: string
  @ApiProperty() memberNumber!: string
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null
  @ApiProperty({ enum: ['member', 'platform_root'] }) kind!: 'member' | 'platform_root'
}
export class AdminMemberDetailDto extends AdminMemberSummaryDto {
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null
  @ApiProperty({ type: String, nullable: true }) email!: string | null
  @ApiProperty({ type: String, nullable: true }) hometown!: string | null
  @ApiProperty({ type: String, nullable: true }) resources!: string | null
  @ApiProperty({ type: String, nullable: true }) needs!: string | null
  @ApiProperty({ type: String, nullable: true }) bio!: string | null
  @ApiProperty() inviteCode!: string
  @ApiProperty({ type: AdminMemberRelationDto, nullable: true }) inviter!: AdminMemberRelationDto | null
  @ApiProperty() inviteeCount!: number
}
export class AdminMemberListDto {
  @ApiProperty({ type: [AdminMemberSummaryDto] }) items!: AdminMemberSummaryDto[]
  @ApiProperty() total!: number
  @ApiProperty() hasMore!: boolean
}
