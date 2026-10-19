import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class DescriptionAttributesDto {
  @ApiPropertyOptional() bold?: boolean
  @ApiPropertyOptional() italic?: boolean
  @ApiPropertyOptional() underline?: boolean
  @ApiPropertyOptional({ enum: ['ordered', 'bullet'] }) list?: 'ordered' | 'bullet'
}
export class DescriptionOperationDto {
  @ApiProperty() insert!: string
  @ApiPropertyOptional({ type: DescriptionAttributesDto }) attributes?: DescriptionAttributesDto
}
export class DescriptionDeltaDto {
  @ApiProperty({ type: [DescriptionOperationDto], maxItems: 1000 }) ops!: DescriptionOperationDto[]
}
