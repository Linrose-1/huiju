import { ApiProperty } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsObject, IsString, Length, Max, Min, ValidateNested } from 'class-validator'
import { mcpOptionalFields, type McpOptionalField, type McpPartnerSnapshot, type McpPermission } from '../database/schema/platform-mcp.js'

function trim({ value }: { value: unknown }) { return typeof value === 'string' ? value.trim() : value }

export class McpStatusDto {
  @ApiProperty({ enum: [false] }) enabled!: false
  @ApiProperty({ enum: [false] }) ready!: false
}

export class McpPermissionDto implements McpPermission {
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiProperty({ enum: [...mcpOptionalFields], isArray: true, maxItems: mcpOptionalFields.length, uniqueItems: true })
  @IsArray() @ArrayMaxSize(mcpOptionalFields.length) @ArrayUnique() @IsIn(mcpOptionalFields, { each: true })
  fields!: McpOptionalField[]
}

export class CreateMcpPartnerInput {
  @ApiProperty({ minLength: 1, maxLength: 60 }) @Transform(trim) @IsString() @Length(1, 60) name!: string
  @ApiProperty({ maxLength: 200 }) @Transform(trim) @IsString() @Length(0, 200) remark!: string
}

export class UpdateMcpPartnerInput extends CreateMcpPartnerInput {
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiProperty({ type: McpPermissionDto }) @IsDefined() @IsObject() @ValidateNested() @Type(() => McpPermissionDto) search!: McpPermissionDto
  @ApiProperty({ type: McpPermissionDto }) @IsDefined() @IsObject() @ValidateNested() @Type(() => McpPermissionDto) detail!: McpPermissionDto
  @ApiProperty({ minimum: 1, maximum: 4294967294 }) @IsInt() @Min(1) @Max(4294967294) version!: number
}

export class McpPartnerDto extends UpdateMcpPartnerInput implements McpPartnerSnapshot {
  @ApiProperty({ format: 'uuid' }) id!: string
}

export class McpAuditDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() actorName!: string
  @ApiProperty() partnerName!: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ type: McpPartnerDto, nullable: true }) before!: McpPartnerDto | null
  @ApiProperty({ type: McpPartnerDto }) after!: McpPartnerDto
}

class McpPageDto {
  @ApiProperty() hasMore!: boolean
  @ApiProperty() total!: number
}

export class McpPartnerPageDto extends McpPageDto {
  @ApiProperty({ type: [McpPartnerDto] }) items!: McpPartnerDto[]
}

export class McpAuditPageDto extends McpPageDto {
  @ApiProperty({ type: [McpAuditDto] }) items!: McpAuditDto[]
}
