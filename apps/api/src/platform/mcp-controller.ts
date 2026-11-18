import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common'
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AdminService } from '../admin/service.js'
import { ErrorDto } from '../flow/dto.js'
import { PageQuery } from '../flow/pagination.js'
import { CreateMcpPartnerInput, McpAuditPageDto, McpPartnerDto, McpPartnerPageDto, McpStatusDto, UpdateMcpPartnerInput } from './mcp-dto.js'
import { McpSettingsService } from './mcp-service.js'

type Request = { headers: { cookie?: string; origin?: string; 'x-csrf-token'?: string } }
function context({ headers }: Request) { return { cookie: headers.cookie, origin: headers.origin, csrfToken: headers['x-csrf-token'] } }

@Controller('admin/platform/mcp') @ApiTags('admin-platform') @ApiCookieAuth('admin_session')
@ApiResponse({ status: 400, type: ErrorDto }) @ApiResponse({ status: 401, type: ErrorDto }) @ApiResponse({ status: 403, type: ErrorDto })
export class AdminMcpController {
  constructor(private readonly mcp: McpSettingsService, private readonly admin: AdminService) {}

  @Get() @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: McpStatusDto })
  status(@Req() request: Request) {
    return this.admin.withSession(context(request), () => this.mcp.status(), { superOnly: true })
  }

  @Get('partners') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: McpPartnerPageDto })
  partners(@Query() page: PageQuery, @Req() request: Request) {
    return this.admin.withSession(context(request), tx => this.mcp.partners(tx, page), { superOnly: true })
  }

  @Post('partners') @Header('Cache-Control', 'no-store') @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCreatedResponse({ type: McpPartnerDto })
  create(@Body() input: CreateMcpPartnerInput, @Req() request: Request) {
    return this.admin.withSession(context(request), (tx, actor) => this.mcp.create(tx, input, actor), { superOnly: true, write: true })
  }

  @Put('partners/:id') @Header('Cache-Control', 'no-store') @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: McpPartnerDto }) @ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 409, type: ErrorDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateMcpPartnerInput, @Req() request: Request) {
    return this.admin.withSession(context(request), (tx, actor) => this.mcp.update(tx, id, input, actor), { superOnly: true, write: true })
  }

  @Get('audit') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: McpAuditPageDto })
  audit(@Query() page: PageQuery, @Req() request: Request) {
    return this.admin.withSession(context(request), tx => this.mcp.audit(tx, page), { superOnly: true })
  }
}
