import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsBoolean, IsInt, IsString, Length, Max, Min } from 'class-validator'

export class PublicBrandDto {
  @ApiProperty({ minLength: 1, maxLength: 30 }) displayName!: string
  @ApiProperty() visible!: boolean
}

export class BrandDto extends PublicBrandDto {
  @ApiProperty({ minimum: 0 }) version!: number
}

export class BrandInput {
  @ApiProperty({ minLength: 1, maxLength: 30 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 30) displayName!: string
  @ApiProperty() @IsBoolean() visible!: boolean
  @ApiProperty({ minimum: 0, maximum: 4294967294 }) @IsInt() @Min(0) @Max(4294967294) version!: number
}
