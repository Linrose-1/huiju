import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common'
import { ApiCookieAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ErrorDto } from '../flow/dto.js'
import { AdminMemberDetailDto, AdminMemberListDto, AdminMemberQuery } from './member-dto.js'
import { AdminMemberService } from './member-service.js'
import { AdminService } from './service.js'

@ApiTags('admin-members') @ApiCookieAuth('admin_session')
@ApiResponse({ status: 400, type: ErrorDto }) @ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 503, type: ErrorDto })
@Controller('admin/members')
export class AdminMemberController {
  constructor(private readonly admin: AdminService, private readonly members: AdminMemberService) {}

  @Get() @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: AdminMemberListDto })
  list(@Query() query: AdminMemberQuery, @Req() request: { headers: { cookie?: string } }) {
    return this.admin.withSession({ cookie: request.headers.cookie }, tx => this.members.list(tx, query))
  }

  @Get(':id') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: AdminMemberDetailDto })
  detail(@Param('id', ParseUUIDPipe) id: string, @Req() request: { headers: { cookie?: string } }) {
    return this.admin.withSession({ cookie: request.headers.cookie }, tx => this.members.detail(tx, id))
  }
}
