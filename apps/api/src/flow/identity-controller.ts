import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, Patch, Post, StreamableFile } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { IdentityService } from './identity.js'
import { AvatarInput, ErrorDto, LoginInput, MemberDto, OkDto, PhoneInput, ProfileInput, SessionDto, WechatIdentityInput } from './dto.js'

@ApiTags('identity')
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
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @ApiOperation({ security: [] })
  @HttpCode(200)
  @Post('auth/wechat/identify')
  @ApiOkResponse({ type: SessionDto })
  identify(@Body() body: WechatIdentityInput) { return this.identity.identify(body.code, body.inviteCode) }

  @ApiOperation({ security: [] })
  @HttpCode(200)
  @Post('auth/wechat/session')
  @ApiOkResponse({ type: SessionDto })
  login(
    @Body()
    body: LoginInput) { return this.identity.login(body.code, body.inviteCode, body) }

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

}
