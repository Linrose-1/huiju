import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { SpecialInviteService } from './special-invite.js'
import { SpecialInviteCodeDto, SpecialInviteCreateInput, SpecialInviteListDto, SpecialInviteQuery, SpecialInviteVerifiedDto, SpecialInviteVerifyInput } from './special-invite-dto.js'

@ApiTags('special-invites') @ApiBearerAuth()
@Controller('activities/:id/special-invite-codes')
export class SpecialInviteController {
  constructor(private readonly invites: SpecialInviteService) {}
  @Post() @HttpCode(200) @ApiOkResponse({ type: SpecialInviteCodeDto })
  create(@Param('id', ParseUUIDPipe) id: string, @Body() body: SpecialInviteCreateInput, @Headers('authorization') header?: string) { return this.invites.create(id, body.phone, header) }
  @Get() @ApiOkResponse({ type: SpecialInviteListDto })
  list(@Param('id', ParseUUIDPipe) id: string, @Query() query: SpecialInviteQuery, @Headers('authorization') header?: string) { return this.invites.list(id, query, header) }
  @Post('verify') @HttpCode(200) @ApiOkResponse({ type: SpecialInviteVerifiedDto })
  verify(@Param('id', ParseUUIDPipe) id: string, @Body() body: SpecialInviteVerifyInput, @Headers('authorization') header?: string) { return this.invites.verify(id, body.code, header) }
}
