import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsBoolean, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class AdminLoginInput {
  @ApiProperty({ minLength: 3, maxLength: 64 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsString() @Matches(/^[a-z0-9][a-z0-9_.-]{2,63}$/) username!: string
  @ApiProperty({ maxLength: 128 }) @IsString() @MinLength(1) @MaxLength(128) password!: string
}
export class AdminTemporaryPasswordInput {
  @ApiProperty({ minLength: 12, maxLength: 128 }) @IsString() @MinLength(12) @MaxLength(128) temporaryPassword!: string
}
export class AdminCreateInput extends AdminTemporaryPasswordInput {
  @ApiProperty({ minLength: 3, maxLength: 64 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsString() @Matches(/^[a-z0-9][a-z0-9_.-]{2,63}$/) username!: string
  @ApiProperty({ maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(100) displayName!: string
}
export class AdminPasswordInput {
  @ApiProperty({ maxLength: 128 }) @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string
  @ApiProperty({ minLength: 12, maxLength: 128 }) @IsString() @MinLength(12) @MaxLength(128) newPassword!: string
}
export class AdminStatusInput {
  @ApiProperty() @IsBoolean() active!: boolean
}
export class AdminAccountDto {
  @ApiProperty() id!: string
  @ApiProperty() username!: string
  @ApiProperty() displayName!: string
  @ApiProperty({ enum: ['super_admin', 'operator'] }) role!: 'super_admin' | 'operator'
  @ApiProperty() active!: boolean
  @ApiProperty() mustChangePassword!: boolean
  @ApiProperty() createdAt!: string
}
export class AdminSessionDto {
  @ApiProperty({ type: AdminAccountDto }) account!: AdminAccountDto
  @ApiProperty() csrfToken!: string
}
export class AdminAccountListDto {
  @ApiProperty({ type: [AdminAccountDto] }) items!: AdminAccountDto[]
}
