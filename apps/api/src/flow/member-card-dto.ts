import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsBoolean, IsEmail, IsString, MaxLength, ValidateIf } from 'class-validator'

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value

export class ProfileDetailsInput {
  @ApiProperty({ maxLength: 100 }) @Transform(trim) @IsString() @MaxLength(100)
  realName!: string

  @ApiProperty({ maxLength: 320 }) @Transform(trim) @IsString() @MaxLength(320)
  @ValidateIf((_object, value) => value !== '') @IsEmail()
  email!: string

  @ApiProperty({ maxLength: 100 }) @Transform(trim) @IsString() @MaxLength(100)
  hometown!: string

  @ApiProperty({ maxLength: 2000 }) @Transform(trim) @IsString() @MaxLength(2000)
  bio!: string

  @ApiProperty({ maxLength: 2000 }) @Transform(trim) @IsString() @MaxLength(2000)
  resources!: string

  @ApiProperty({ maxLength: 2000 }) @Transform(trim) @IsString() @MaxLength(2000)
  needs!: string
}

export class ProfileDetailsDto {
  @ApiProperty({ type: String, nullable: true }) realName!: string | null
  @ApiProperty({ type: String, nullable: true }) email!: string | null
  @ApiProperty({ type: String, nullable: true }) hometown!: string | null
  @ApiProperty({ type: String, nullable: true }) bio!: string | null
  @ApiProperty({ type: String, nullable: true }) resources!: string | null
  @ApiProperty({ type: String, nullable: true }) needs!: string | null
}

export class CardSettingsDto {
  @ApiProperty() @IsBoolean() showRealName!: boolean
  @ApiProperty() @IsBoolean() showEmail!: boolean
  @ApiProperty() @IsBoolean() showBoundPhone!: boolean
  @ApiProperty() @IsBoolean() showHometown!: boolean
  @ApiProperty() @IsBoolean() showBio!: boolean
  @ApiProperty() @IsBoolean() showResources!: boolean
  @ApiProperty() @IsBoolean() showNeeds!: boolean
}

export class MemberCardDto {
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null
  @ApiProperty() displayName!: string
  @ApiPropertyOptional({ type: String, nullable: true }) realName?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) email?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) boundPhone?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) hometown?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) bio?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) resources?: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) needs?: string | null
}
