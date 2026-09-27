import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ErrorDto } from './dto.js'
import { CardSettingsDto, MemberCardDto, ProfileDetailsDto, ProfileDetailsInput } from './member-card-dto.js'
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

  @Get(':id/card')
  @ApiOkResponse({ type: MemberCardDto })
  card(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.cards.card(id, header) }
}
