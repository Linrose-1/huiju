import { Body, Controller, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AdminService } from '../admin/service.js'
import { ErrorDto, OkDto } from '../flow/dto.js'
import { PageQuery } from '../flow/pagination.js'
import { AuditListDto, ConsentInput, ContentDto, ContentInput, EditorInput, EditorListDto, LegalDto } from './dto.js'
import { legalDocuments } from './legal.js'
import { PlatformService } from './service.js'

@Controller('platform') @ApiTags('platform')
@ApiResponse({ status: 400, type: ErrorDto }) @ApiResponse({ status: 401, type: ErrorDto }) @ApiResponse({ status: 403, type: ErrorDto })
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}
  @Get('legal') @Header('Cache-Control', 'no-store') @ApiOperation({ security: [] }) @ApiOkResponse({ type: LegalDto })
  legal() { return legalDocuments }
  @Get('content') @Header('Cache-Control', 'no-store') @ApiOperation({ security: [{ bearer: [] }, {}] }) @ApiOkResponse({ type: ContentDto })
  content(@Headers('authorization') header?: string) { return this.platform.publicContent(header) }
  @Post('content') @HttpCode(200) @ApiBearerAuth() @ApiOkResponse({ type: ContentDto })
  save(@Body() input: ContentInput, @Headers('authorization') header?: string) { return this.platform.saveMemberContent(header, input) }
  @Post('legal/accept') @HttpCode(200) @ApiBearerAuth() @ApiOkResponse({ type: OkDto })
  accept(@Body() input: ConsentInput, @Headers('authorization') header?: string) { return this.platform.accept(header, input) }
}
type Request = { headers: { cookie?: string; origin?: string; 'x-csrf-token'?: string } }
const context = (request: Request) => ({ cookie: request.headers.cookie, origin: request.headers.origin, csrfToken: request.headers['x-csrf-token'] })
@Controller('admin/platform') @ApiTags('admin-platform') @ApiCookieAuth('admin_session')
@ApiResponse({ status: 400, type: ErrorDto }) @ApiResponse({ status: 401, type: ErrorDto }) @ApiResponse({ status: 403, type: ErrorDto }) @ApiResponse({ status: 404, type: ErrorDto })
export class AdminPlatformController {
  constructor(private readonly platform: PlatformService, private readonly admin: AdminService) {}
  @Get('content') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: ContentDto })
  content(@Req() request: Request) { return this.admin.withSession(context(request), async tx => ({ ...await this.platform.content(tx), canEdit: true })) }
  @Patch('content') @ApiHeader({ name: 'X-CSRF-Token', required: true }) @ApiOkResponse({ type: ContentDto })
  save(@Body() input: ContentInput, @Req() request: Request) {
    return this.admin.withSession(context(request), (tx, account) => this.platform.saveContent(tx, input, { type: 'admin', id: account.id }), { write: true })
  }
  @Get('content/history') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: AuditListDto })
  history(@Query() query: PageQuery, @Req() request: Request) { return this.admin.withSession(context(request), tx => this.platform.history(tx, query)) }
  @Get('editors') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: EditorListDto })
  editors(@Query() query: PageQuery, @Req() request: Request) { return this.admin.withSession(context(request), tx => this.platform.editors(tx, query), { superOnly: true }) }
  @Put('editors/:memberId') @ApiHeader({ name: 'X-CSRF-Token', required: true }) @ApiOkResponse({ type: OkDto })
  editor(@Param('memberId', ParseUUIDPipe) id: string, @Body() input: EditorInput, @Req() request: Request) {
    return this.admin.withSession(context(request), (tx, account) => this.platform.setEditor(tx, id, input.enabled, account.id), { write: true, superOnly: true })
  }
}
