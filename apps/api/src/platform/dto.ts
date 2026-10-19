import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsString, Length, Matches } from 'class-validator'

export class ContentInput {
  @ApiProperty() @IsString() @Length(1, 200) @Matches(/\S/) activityText!: string
  @ApiProperty() @IsString() @Length(1, 200) @Matches(/\S/) assistantText!: string
}
export class ContentDto extends ContentInput {
  @ApiProperty() canEdit!: boolean
}
export class EditorInput {
  @ApiProperty() @IsBoolean() enabled!: boolean
}
export class ConsentInput {
  @ApiProperty() @IsString() @Length(1, 64) termsVersion!: string
  @ApiProperty() @IsString() @Length(1, 64) privacyVersion!: string
}
export class LegalDocumentDto {
  @ApiProperty() version!: string
  @ApiProperty() title!: string
  @ApiProperty() body!: string
}
export class LegalDto {
  @ApiProperty() development!: boolean
  @ApiProperty({ type: LegalDocumentDto }) terms!: LegalDocumentDto
  @ApiProperty({ type: LegalDocumentDto }) privacy!: LegalDocumentDto
}
export class AuditDto {
  @ApiProperty() id!: string
  @ApiProperty({ enum: ['admin', 'member'] }) actorType!: string
  @ApiProperty() actorId!: string
  @ApiProperty() actorName!: string
  @ApiProperty({ enum: ['content', 'editor'] }) action!: string
  @ApiProperty({ type: String, nullable: true }) targetMemberId!: string | null
  @ApiProperty({ type: String, nullable: true }) targetMemberNumber!: string | null
  @ApiProperty({ type: Object }) before!: Record<string, string | boolean>
  @ApiProperty({ type: Object }) after!: Record<string, string | boolean>
  @ApiProperty() createdAt!: string
}
export class AuditListDto {
  @ApiProperty({ type: [AuditDto] }) items!: AuditDto[]
  @ApiProperty() hasMore!: boolean
}
export class EditorDto {
  @ApiProperty() memberId!: string
  @ApiProperty() memberNumber!: string
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null
  @ApiProperty() enabled!: boolean
}
export class EditorListDto {
  @ApiProperty({ type: [EditorDto] }) items!: EditorDto[]
  @ApiProperty() hasMore!: boolean
}
