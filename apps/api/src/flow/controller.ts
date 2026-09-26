import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags
} from '@nestjs/swagger'
import { IdentityService } from './identity.js'
import { ActivityService } from './activity.js'
import {
  ActivityDto,
  ActivityListDto,
  ErrorDto,
  AnswersInput,
  AvatarInput,
  LoginInput,
  MemberDto,
  OkDto,
  PhoneInput,
  ProfileInput,
  PublicRosterDto,
  RegistrationDto,
  RegistrationInput,
  RegistrationListDto,
  SessionDto
} from './dto.js'

@ApiTags('最小业务链路')
@ApiResponse({
  status: 400,
  type: ErrorDto
})
@ApiResponse({
  status: 401,
  type: ErrorDto
})
@ApiResponse({
  status: 403,
  type: ErrorDto
})
@ApiResponse({
  status: 404,
  type: ErrorDto
})
@ApiResponse({
  status: 409,
  type: ErrorDto
})
@ApiResponse({
  status: 500,
  type: ErrorDto
})
@ApiResponse({
  status: 503,
  type: ErrorDto
})
@ApiBearerAuth()
@Controller()
export class FlowController {
  constructor(
    private readonly identity: IdentityService,
    private readonly activity: ActivityService
  ) {}

  @ApiOperation({ security: [] })
  @HttpCode(200)
  @Post('auth/wechat/session')
  @ApiOkResponse({ type: SessionDto })
  login(
    @Body()
    body: LoginInput) { return this.identity.login(body.code, body.inviteCode) }

  @Get('auth/session')
  @ApiOkResponse({ type: MemberDto })
  me(
    @Headers('authorization')
    header?: string) { return this.identity.me(header) }

  @Delete('auth/session')
  @ApiOkResponse({ type: OkDto })
  logout(
    @Headers('authorization')
    header?: string) { return this.identity.logout(header) }

  @HttpCode(200)
  @Post('members/me/phone')
  @ApiOkResponse({ type: MemberDto })
  phone(
    @Body()
    body: PhoneInput,
    @Headers('authorization')
    header?: string) { return this.identity.phone(header, body.code) }

  @Patch('members/me/profile')
  @ApiOkResponse({ type: MemberDto })
  profile(
    @Body()
    body: ProfileInput,
    @Headers('authorization')
    header?: string) { return this.identity.profile(header, body.displayName) }

  @HttpCode(200)
  @Post('members/me/profile')
  @ApiOkResponse({ type: MemberDto })
  profileFromMiniapp(
    @Body()
    body: ProfileInput,
    @Headers('authorization')
    header?: string) { return this.identity.profile(header, body.displayName) }

  @HttpCode(200)
  @Post('members/me/avatar')
  @ApiOkResponse({ type: MemberDto })
  avatar(
    @Body()
    body: AvatarInput,
    @Headers('authorization')
    header?: string) { return this.identity.avatar(header, body) }

  @ApiOperation({ security: [] })
  @Header('X-Content-Type-Options', 'nosniff')
  @Get('media/avatars/:name')
  async image(
    @Param('name')
    name: string) {
    const bytes = await this.identity.image(name)
    return new StreamableFile(bytes, {
      type: name.endsWith('.png') ? 'image/png' : 'image/jpeg',
      disposition: 'inline',
      length: bytes.length
    })
  }

  @ApiOperation({ security: [] })
  @Get('activities')
  @ApiOkResponse({ type: ActivityListDto })
  list() { return this.activity.list() }

  @ApiOperation({ security: [] })
  @Get('activities/:id')
  @ApiOkResponse({ type: ActivityDto })
  detail(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Headers('authorization')
    header?: string) { return this.activity.detail(id, header) }

  @ApiOperation({ security: [] })
  @Get('activities/:id/registrations')
  @ApiOkResponse({ type: PublicRosterDto })
  roster(
    @Param('id', ParseUUIDPipe)
    id: string) { return this.activity.roster(id) }

  @Get('activities/:id/registrations/me')
  @ApiOkResponse({ type: RegistrationDto })
  mine(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Headers('authorization')
    header?: string) { return this.activity.mine(id, header) }

  @Get('members/me/registrations')
  @ApiOkResponse({ type: RegistrationListDto })
  allMine(
    @Headers('authorization')
    header?: string) { return this.activity.allMine(header) }

  @HttpCode(200)
  @Post('activities/:id/registrations')
  @ApiOkResponse({ type: RegistrationDto })
  register(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Body()
    body: RegistrationInput,
    @Headers('authorization')
    header?: string) { return this.activity.write(id, header, 'register', body) }

  @Patch('activities/:id/registrations/me')
  @ApiOkResponse({ type: RegistrationDto })
  edit(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Body()
    body: AnswersInput,
    @Headers('authorization')
    header?: string) { return this.activity.write(id, header, 'edit', body) }

  @HttpCode(200)
  @Post('activities/:id/registrations/me/answers')
  @ApiOkResponse({ type: RegistrationDto })
  editFromMiniapp(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Body()
    body: AnswersInput,
    @Headers('authorization')
    header?: string) { return this.activity.write(id, header, 'edit', body) }

  @HttpCode(200)
  @Post('activities/:id/registrations/me/cancel')
  @ApiOkResponse({ type: RegistrationDto })
  cancel(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Headers('authorization')
    header?: string) { return this.activity.write(id, header, 'cancel') }
}
