import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, Max, Min } from 'class-validator'
export class ActivityReportDto {
  @ApiProperty() id!: string
  @ApiProperty() title!: string
  @ApiProperty() consultationContact!: string
  @ApiProperty() views!: number
  @ApiProperty() visitors!: number
  @ApiProperty() activeRegistrations!: number
  @ApiProperty() attendedMembers!: number
  @ApiProperty({ type: Number, nullable: true }) conversionRate!: number | null
  @ApiProperty() reviewCount!: number
  @ApiProperty({ type: Number, nullable: true }) averageScore!: number | null
}
export class ActivityRegistrationQuery {
  @ApiPropertyOptional({ type: Number, default: 0 }) @Type(()=>Number) @IsInt() @Min(0) @Max(1000000) offset: number = 0
  @ApiPropertyOptional({ enum: ['all','active','cancelled'], default: 'all' }) @IsIn(['all','active','cancelled']) status = 'all'
}
export class ActivityRegistrationAnswerDto {
  @ApiProperty() questionId!: string
  @ApiProperty() prompt!: string
  @ApiProperty() type!: string
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }) answer!: string | string[]
}
export class ActivityRegistrationDto {
  @ApiProperty() id!: string
  @ApiProperty() memberId!: string
  @ApiProperty() memberNumber!: string
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null
  @ApiProperty() status!: string
  @ApiProperty() contactPhone!: string
  @ApiProperty() registeredAt!: string
  @ApiProperty({ type: String, nullable: true }) cancelledAt!: string | null
  @ApiProperty() attended!: boolean
  @ApiProperty({ type: String, nullable: true }) attendedAt!: string | null
  @ApiProperty({ type: [ActivityRegistrationAnswerDto] }) answers!: ActivityRegistrationAnswerDto[]
}
export class ActivityRegistrationListDto {
  @ApiProperty({ type: [ActivityRegistrationDto] }) items!: ActivityRegistrationDto[]
  @ApiProperty() total!: number
  @ApiProperty() hasMore!: boolean
}
