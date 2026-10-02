import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common'
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { CircleService } from '../circle/service.js'
import { CircleHistoryDto, CircleListDto, CircleQuery, CircleReasonInput } from '../circle/dto.js'
import { PageQuery } from '../flow/pagination.js'
import { OkDto } from '../flow/dto.js'
import { AdminService } from './service.js'
type Request = { headers: { cookie?: string; origin?: string; 'x-csrf-token'?: string } }
@ApiTags('admin-circle') @ApiCookieAuth('admin_session') @Controller('admin/circle/posts')
export class AdminCircleController {
  constructor(private readonly admin: AdminService, private readonly circle: CircleService) {}
  @Get() @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: CircleListDto })
  list(@Query() q: CircleQuery, @Req() r: Request) { return this.admin.withSession({ cookie: r.headers.cookie }, tx => this.circle.adminList(tx, q)) }
  @Get(':id/operations') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: CircleHistoryDto })
  history(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery, @Req() r: Request) { return this.admin.withSession({ cookie: r.headers.cookie }, tx => this.circle.history(tx, id, q)) }
  @Post(':id/remove') @Header('Cache-Control', 'no-store') @HttpCode(200) @ApiHeader({ name: 'X-CSRF-Token', required: true }) @ApiOkResponse({ type: OkDto })
  remove(@Param('id', ParseUUIDPipe) id: string, @Body() b: CircleReasonInput, @Req() r: Request) { return this.change(id, 'remove', b.reason, r) }
  @Post(':id/restore') @Header('Cache-Control', 'no-store') @HttpCode(200) @ApiHeader({ name: 'X-CSRF-Token', required: true }) @ApiOkResponse({ type: OkDto })
  restore(@Param('id', ParseUUIDPipe) id: string, @Body() b: CircleReasonInput, @Req() r: Request) { return this.change(id, 'restore', b.reason, r) }
  private change(id: string, action: 'remove' | 'restore', reason: string, r: Request) {
    return this.admin.withSession({ cookie: r.headers.cookie, origin: r.headers.origin, csrfToken: r.headers['x-csrf-token'] }, (tx, account) => this.circle.moderate(tx, id, action, reason, account.id), { write: true })
  }
}
