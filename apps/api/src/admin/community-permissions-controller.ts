import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Put, Query, Req } from '@nestjs/common'
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CommunityRosterService } from '../flow/community-roster.js'
import { CommunityMemberRouteParams, CommunityPermissionDto, CommunityPermissionListDto, CommunityPermissionsInput } from '../flow/community-roster-dto.js'
import { ErrorDto } from '../flow/dto.js'
import { PageQuery } from '../flow/pagination.js'
import { AdminService } from './service.js'

type Request = { headers: { cookie?: string; origin?: string; 'x-csrf-token'?: string } }

@ApiTags('admin-members') @ApiCookieAuth('admin_session')
@ApiResponse({ status: 400, type: ErrorDto }) @ApiResponse({ status: 403, type: ErrorDto })
@Controller('admin/members/:memberId/community-permissions')
export class AdminCommunityPermissionsController {
  constructor(private readonly admin: AdminService, private readonly roster: CommunityRosterService) {}

  @Get() @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: CommunityPermissionListDto })
  list(@Param('memberId', ParseUUIDPipe) memberId: string, @Query() page: PageQuery, @Req() request: Request) {
    return this.admin.withSession({ cookie: request.headers.cookie }, tx => this.roster.memberPermissions(tx, memberId, page), { superOnly: true })
  }

  @Put(':communityId') @Header('Cache-Control', 'no-store') @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: CommunityPermissionDto }) @ApiResponse({ status: 404, type: ErrorDto })
  set(@Param() params: CommunityMemberRouteParams, @Body() input: CommunityPermissionsInput, @Req() request: Request) {
    const { cookie, origin, 'x-csrf-token': csrfToken } = request.headers
    return this.admin.withSession({ cookie, origin, csrfToken }, (tx, actor) =>
      this.roster.setMemberPermissions(tx, params.memberId, params.communityId, input, actor.id), { superOnly: true, write: true })
  }
}
