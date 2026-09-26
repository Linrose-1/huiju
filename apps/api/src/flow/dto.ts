import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested
} from 'class-validator'

export class LoginInput {
  @ApiProperty()
  @IsString()
  @Length(1, 512)
  code!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 32)
  inviteCode?: string
}

export class PhoneInput {
  @ApiProperty()
  @IsString()
  @Length(1, 512)
  code!: string
}

export class ProfileInput {
  @ApiProperty()
  @IsString()
  @Length(1, 100)
  @Matches(/\S/)
  displayName!: string
}

export class AvatarInput {
  @ApiProperty({ enum: ['image/png', 'image/jpeg'] })
  @IsIn(['image/png', 'image/jpeg'])
  mimeType!: string

  @ApiProperty()
  @IsString()
  @MaxLength(2800000)
  @Matches(/^[A-Za-z0-9+/]+={0,2}$/)
  base64!: string
}

export class MemberDto {
  @ApiProperty()
  id!: string

  @ApiProperty()
  memberNumber!: string

  @ApiProperty()
  inviteCode!: string

  @ApiProperty({
    nullable: true,
    type: String
  })
  displayName!: string | null

  @ApiProperty({
    nullable: true,
    type: String
  })
  avatarUrl!: string | null

  @ApiProperty({
    nullable: true,
    type: String
  })
  boundPhone!: string | null

  @ApiProperty()
  profileComplete!: boolean
}

export class SessionDto {
  @ApiProperty()
  token!: string

  @ApiProperty()
  expiresAt!: string

  @ApiProperty({ type: MemberDto })
  member!: MemberDto
}

export class AnswerInput {
  @ApiProperty()
  @IsUUID()
  questionId!: string

  @ApiProperty({
    oneOf: [{ type: 'string' }, {
      type: 'array',
      items: { type: 'string' }
    }]
  })
  @Allow()
  value!: string | string[]
}

export class RegistrationInput {
  @ApiProperty()
  @IsString()
  @Matches(/^\+?[0-9]{6,20}$/)
  contactPhone!: string

  @ApiProperty({ type: [AnswerInput] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AnswerInput)
  answers!: AnswerInput[]
}

export class AnswersInput {
  @ApiProperty({ type: [AnswerInput] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AnswerInput)
  answers!: AnswerInput[]
}

export class QuestionDto {
  @ApiProperty()
  id!: string

  @ApiProperty({ enum: ['short_text', 'long_text', 'single', 'multiple'] })
  type!: string

  @ApiProperty()
  prompt!: string

  @ApiProperty()
  required!: boolean

  @ApiProperty({
    type: [String],
    nullable: true
  })
  options!: string[] | null
}

export class PublicMemberDto {
  @ApiProperty({
    nullable: true,
    type: String
  })
  avatarUrl!: string | null

  @ApiProperty({
    nullable: true,
    type: String
  })
  displayName!: string | null
}

export class ActivityDto {
  @ApiProperty({
    type: PublicMemberDto,
    nullable: true
  })
  organizer!: PublicMemberDto | null

  @ApiProperty()
  id!: string

  @ApiProperty()
  title!: string

  @ApiProperty()
  description!: string

  @ApiProperty({
    nullable: true,
    type: String
  })
  coverUrl!: string | null

  @ApiProperty()
  location!: string

  @ApiProperty()
  startsAt!: string

  @ApiProperty()
  endsAt!: string

  @ApiProperty()
  registrationDeadline!: string

  @ApiProperty({
    nullable: true,
    type: Number
  })
  capacity!: number | null

  @ApiProperty()
  activeRegistrationCount!: number

  @ApiProperty({
    nullable: true,
    type: Number
  })
  cancellationRegistrationCount!: number | null

  @ApiProperty({ enum: ['free', 'paid'] })
  feeType!: string

  @ApiProperty({
    nullable: true,
    type: Number
  })
  feeAmountCents!: number | null

  @ApiProperty({ enum: ['open', 'closed', 'full', 'cancelled', 'removed'] })
  registrationState!: string

  @ApiProperty({
    nullable: true,
    type: String
  })
  cancellationReason!: string | null

  @ApiPropertyOptional()
  consultationContact?: string

  @ApiProperty({ type: [QuestionDto] })
  questions!: QuestionDto[]
}

export class ActivityListDto {
  @ApiProperty({ type: [ActivityDto] })
  items!: ActivityDto[]
}

export class RegistrationDto {
  @ApiProperty()
  id!: string

  @ApiProperty()
  activityId!: string

  @ApiProperty({ enum: ['active', 'cancelled'] })
  status!: string

  @ApiProperty()
  contactPhone!: string

  @ApiProperty({ type: [AnswerInput] })
  answers!: AnswerInput[]

  @ApiProperty()
  currentRegisteredAt!: string

  @ApiProperty({
    nullable: true,
    type: String
  })
  cancelledAt!: string | null
}

export class MyRegistrationDto extends RegistrationDto {
  @ApiProperty({ type: ActivityDto })
  activity!: ActivityDto
}

export class RegistrationListDto {
  @ApiProperty({ type: [MyRegistrationDto] })
  items!: MyRegistrationDto[]
}

export class PublicRosterDto {
  @ApiProperty({ type: [PublicMemberDto] })
  items!: PublicMemberDto[]
}

export class OkDto {
  @ApiProperty()
  ok!: boolean
}

export class ErrorDto {
  @ApiProperty()
  code!: string

  @ApiProperty()
  message!: string

  @ApiProperty()
  requestId!: string
}
