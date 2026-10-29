import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'

export class ConnectionQuery {
  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER)
  cursor: number = 0

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit: number = 20
}

export class FellowSummaryDto {
  @ApiProperty({ type: String, nullable: true }) memberId!: string | null
  @ApiProperty() displayName!: string
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null
  @ApiProperty() canOpenCard!: boolean
}

export class FellowListDto {
  @ApiProperty({ type: FellowSummaryDto, nullable: true }) inviter!: FellowSummaryDto | null
  @ApiProperty({ type: [FellowSummaryDto] }) items!: FellowSummaryDto[]
  @ApiProperty() total!: number
  @ApiProperty() hasMore!: boolean
}

export class ConnectionNodeDto {
  @ApiProperty() index!: number
  @ApiProperty({ type: FellowSummaryDto }) member!: FellowSummaryDto
}

export class ConnectionEdgeDto {
  @ApiProperty({ description: '真实邀请人的绝对节点索引' }) fromIndex!: number
  @ApiProperty({ description: '真实受邀人的绝对节点索引' }) toIndex!: number
}

export class ConnectionPathDto {
  @ApiProperty({ type: FellowSummaryDto }) source!: FellowSummaryDto
  @ApiProperty({ type: FellowSummaryDto }) target!: FellowSummaryDto
  @ApiProperty() connected!: boolean
  @ApiProperty() totalNodes!: number
  @ApiProperty({ type: [ConnectionNodeDto] }) nodes!: ConnectionNodeDto[]
  @ApiProperty({ type: [ConnectionEdgeDto] }) edges!: ConnectionEdgeDto[]
  @ApiProperty({ type: Number, nullable: true }) nextCursor!: number | null
}
