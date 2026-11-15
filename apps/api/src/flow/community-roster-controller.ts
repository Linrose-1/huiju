import { Controller, Get, Header, Headers, Query, Body, Put, Param, ParseUUIDPipe } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { CommunityAccessDto, CommunityRecognitionInput, CommunityRosterDto, CommunityRosterMemberDto } from './community-roster-dto.js'
import { CommunityRosterService } from './community-roster.js'
import { DEFAULT_COMMUNITY_ID } from './member-number.js'
import { PageQuery } from './pagination.js'

@ApiTags('communities') @ApiBearerAuth()
@Controller('communities/' + DEFAULT_COMMUNITY_ID)
export class CommunityRosterController {
  constructor(private readonly roster: CommunityRosterService) {}

  @Get('me') @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: CommunityAccessDto })
  me(@Headers('authorization') header?: string) { return this.roster.access(header) }

  @Get('members') @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: CommunityRosterDto })
  list(@Query() query: PageQuery, @Headers('authorization') header?: string) {
    return this.roster.list(query, header)
  }

  @Put('members/:memberId') @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: CommunityRosterMemberDto })
  recognize(@Param('memberId', ParseUUIDPipe) memberId: string, @Body() input: CommunityRecognitionInput, @Headers('authorization') header?: string) {
    return this.roster.recognize(memberId, input.isRegistered, header)
  }
}
