import { Controller, Get, Header, Headers, Query, Body, Put, Param } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { CommunityAccessDto, CommunityMemberRouteParams, CommunityRecognitionInput, CommunityRosterDto, CommunityRosterMemberDto, CommunityRouteParams } from './community-roster-dto.js'
import { CommunityRosterService } from './community-roster.js'
import { PageQuery } from './pagination.js'

@ApiTags('communities') @ApiBearerAuth()
@Controller('communities/:communityId')
export class CommunityRosterController {
  constructor(private readonly roster: CommunityRosterService) {}

  @Get('me') @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: CommunityAccessDto })
  me(@Param() params: CommunityRouteParams, @Headers('authorization') header?: string) { return this.roster.access(header, params.communityId) }

  @Get('members') @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: CommunityRosterDto })
  list(@Param() params: CommunityRouteParams, @Query() query: PageQuery, @Headers('authorization') header?: string) {
    return this.roster.list(query, header, params.communityId)
  }

  @Put('members/:memberId') @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: CommunityRosterMemberDto })
  recognize(@Param() params: CommunityMemberRouteParams, @Body() input: CommunityRecognitionInput, @Headers('authorization') header?: string) {
    return this.roster.recognize(params.memberId, input.isRegistered, header, params.communityId)
  }
}
