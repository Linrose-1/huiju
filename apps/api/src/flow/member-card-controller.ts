import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, StreamableFile } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AvatarInput, ErrorDto } from './dto.js'
import { CardSettingsDto, MemberCardDto, ProfileDetailsDto, ProfileDetailsInput, WechatQrDto } from './member-card-dto.js'
import { MemberCardService } from './member-card.js'

@ApiTags('会员资料与名片')
@ApiBearerAuth()
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 404, type: ErrorDto })
@ApiResponse({ status: 500, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@Controller('members')
export class MemberCardController {
  constructor(private readonly cards: MemberCardService) {}

  @Get('me/profile-details')
  @ApiOkResponse({ type: ProfileDetailsDto })
  profile(@Headers('authorization') header?: string) { return this.cards.profile(header) }

  @Post('me/profile-details') @HttpCode(200)
  @ApiOkResponse({ type: ProfileDetailsDto })
  saveProfile(@Body() body: ProfileDetailsInput, @Headers('authorization') header?: string) { return this.cards.saveProfile(body, header) }

  @Get('me/card-settings')
  @ApiOkResponse({ type: CardSettingsDto })
  settings(@Headers('authorization') header?: string) { return this.cards.settings(header) }

  @Post('me/card-settings') @HttpCode(200)
  @ApiOkResponse({ type: CardSettingsDto })
  saveSettings(@Body() body: CardSettingsDto, @Headers('authorization') header?: string) { return this.cards.saveSettings(body, header) }

  @Post('me/wechat-qr') @HttpCode(200)
  @ApiOkResponse({ type: WechatQrDto })
  saveWechatQr(@Body() body: AvatarInput, @Headers('authorization') header?: string) { return this.cards.saveWechatQr(body, header) }

  @Delete('me/wechat-qr') @HttpCode(200)
  @ApiOkResponse({ type: WechatQrDto })
  removeWechatQr(@Headers('authorization') header?: string) { return this.cards.removeWechatQr(header) }

  @Get(':id/wechat-qr')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOkResponse({ content: { 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } } } })
  async wechatQr(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) {
    const image = await this.cards.wechatQr(id, header)
    return new StreamableFile(image.bytes, { type: image.type, disposition: 'inline', length: image.bytes.length })
  }

  @Get(':id/card')
  @ApiOkResponse({ type: MemberCardDto })
  card(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.cards.card(id, header) }
}
