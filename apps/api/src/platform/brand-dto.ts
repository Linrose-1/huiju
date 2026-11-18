import { ApiProperty } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsObject, IsString, IsUUID, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator'

function trim({ value }: { value: unknown }) { return typeof value === 'string' ? value.trim() : value }
export const maxBrandImageBytes = 2 * 1024 * 1024
export const maxBrandImageBase64 = Math.ceil(maxBrandImageBytes / 3) * 4

export class BrandTabNamesDto {
  @ApiProperty({ maxLength: 5 }) @Transform(trim) @IsString() @Length(0, 5) circle!: string
  @ApiProperty({ maxLength: 5 }) @Transform(trim) @IsString() @Length(0, 5) activity!: string
  @ApiProperty({ maxLength: 5 }) @Transform(trim) @IsString() @Length(0, 5) assistant!: string
  @ApiProperty({ maxLength: 5 }) @Transform(trim) @IsString() @Length(0, 5) mine!: string
}

class BrandLogoInput {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== null) @IsUUID() logoImageId!: string | null
}

export class BrandPartnerInput extends BrandLogoInput {
  @ApiProperty({ maxLength: 30 }) @Transform(trim) @IsString() @Length(1, 30) name!: string
  @ApiProperty({ maxLength: 120 }) @Transform(trim) @IsString() @Length(0, 120) description!: string
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== null) @IsUUID() codeImageId!: string | null
  @ApiProperty({ minimum: 0, maximum: 999 }) @IsInt() @Min(0) @Max(999) sortOrder!: number
  @ApiProperty() @IsBoolean() visible!: boolean
}

export class BrandAppearanceDto extends BrandLogoInput {
  @ApiProperty({ type: BrandTabNamesDto }) @IsDefined() @IsObject() @ValidateNested() @Type(() => BrandTabNamesDto)
  tabNames!: BrandTabNamesDto
  @ApiProperty({ type: [BrandPartnerInput], maxItems: 10 }) @IsArray() @ArrayMaxSize(10) @IsObject({ each: true })
  @ValidateNested({ each: true }) @Type(() => BrandPartnerInput) partners!: BrandPartnerInput[]
}

export class PublicBrandDto {
  @ApiProperty({ minLength: 1, maxLength: 30 }) displayName!: string
  @ApiProperty() visible!: boolean
}

export class BrandDto extends PublicBrandDto {
  @ApiProperty({ minimum: 0 }) version!: number
  @ApiProperty({ type: BrandAppearanceDto, required: false }) appearance?: BrandAppearanceDto
}

export class BrandInput {
  @ApiProperty({ minLength: 1, maxLength: 30 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 30) displayName!: string
  @ApiProperty() @IsBoolean() visible!: boolean
  @ApiProperty({ minimum: 0, maximum: 4294967294 }) @IsInt() @Min(0) @Max(4294967294) version!: number
  @ApiProperty({ type: BrandAppearanceDto, required: false })
  @ValidateIf((_object, value) => value !== undefined) @IsObject() @ValidateNested() @Type(() => BrandAppearanceDto) appearance?: BrandAppearanceDto
}

class PublicBrandPartnerDto {
  @ApiProperty() name!: string
  @ApiProperty() description!: string
  @ApiProperty({ type: String, nullable: true }) logoUrl!: string | null
  @ApiProperty() codeUrl!: string
}

export class PublicBrandAppearanceDto extends PublicBrandDto {
  @ApiProperty({ type: String, nullable: true }) logoUrl!: string | null
  @ApiProperty({ type: BrandTabNamesDto }) tabNames!: BrandTabNamesDto
  @ApiProperty({ type: [PublicBrandPartnerDto] }) partners!: PublicBrandPartnerDto[]
}

export class BrandImageInput {
  @ApiProperty({ maxLength: maxBrandImageBase64 }) @IsString() @Length(1, maxBrandImageBase64) base64!: string
  @ApiProperty({ enum: ['image/png', 'image/jpeg'] }) @IsIn(['image/png', 'image/jpeg']) mimeType!: 'image/png' | 'image/jpeg'
  @ApiProperty({ enum: ['logo', 'code'] }) @IsIn(['logo', 'code']) purpose!: 'logo' | 'code'
}

export class BrandImageDto {
  @ApiProperty({ format: 'uuid' }) id!: string
}
