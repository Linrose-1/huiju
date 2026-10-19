import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common'
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ErrorDto, OkDto } from '../flow/dto.js'
import { ActivityModerationService } from '../flow/activity-moderation.js'
import { ActivityModerationHistoryDto, ActivityModerationInput, AdminActivityListDto, AdminActivityQuery } from '../flow/activity-moderation-dto.js'
import { AdminService } from './service.js'
import { ActivityReportService } from './activity-report-service.js'
import { ActivityRegistrationListDto, ActivityRegistrationQuery, ActivityReportDto } from './activity-report-dto.js'

type AdminRequest = { headers: { cookie?: string; origin?: string; 'x-csrf-token'?: string } }

@ApiTags('admin-activities') @ApiCookieAuth('admin_session')
@ApiResponse({ status: 400, type: ErrorDto }) @ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto }) @ApiResponse({ status: 404, type: ErrorDto })
@ApiResponse({ status: 409, type: ErrorDto }) @ApiResponse({ status: 503, type: ErrorDto })
@Controller('admin/activities')
export class AdminActivityController {
  constructor(private readonly admin: AdminService, private readonly activities: ActivityModerationService, private readonly reports: ActivityReportService) {}

  @Get(':id/report') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: ActivityReportDto })
  report(@Param('id', ParseUUIDPipe) id: string, @Req() request: AdminRequest) {
    return this.admin.withSession({ cookie: request.headers.cookie }, tx => this.reports.report(tx, id))
  }

  @Get(':id/registrations') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: ActivityRegistrationListDto })
  registrations(@Param('id', ParseUUIDPipe) id: string, @Query() query: ActivityRegistrationQuery, @Req() request: AdminRequest) {
    return this.admin.withSession({ cookie: request.headers.cookie }, tx => this.reports.registrations(tx, id, query))
  }

  @Get() @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: AdminActivityListDto })
  list(@Query() query: AdminActivityQuery, @Req() request: AdminRequest) {
    return this.admin.withSession({ cookie: request.headers.cookie }, tx => this.activities.list(tx, query))
  }

  @Get(':id/operations') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: ActivityModerationHistoryDto })
  history(@Param('id', ParseUUIDPipe) id: string, @Query() query: AdminActivityQuery, @Req() request: AdminRequest) {
    return this.admin.withSession({ cookie: request.headers.cookie }, tx => this.reports.history(tx, id, query.offset))
  }

  @Post(':id/remove') @Header('Cache-Control', 'no-store') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  remove(@Param('id', ParseUUIDPipe) id: string, @Body() input: ActivityModerationInput, @Req() request: AdminRequest) {
    return this.change(id, 'remove', input, request)
  }

  @Post(':id/restore') @Header('Cache-Control', 'no-store') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  restore(@Param('id', ParseUUIDPipe) id: string, @Body() input: ActivityModerationInput, @Req() request: AdminRequest) {
    return this.change(id, 'restore', input, request)
  }

  private change(id: string, action: 'remove' | 'restore', input: ActivityModerationInput, request: AdminRequest) {
    return this.admin.withSession({ cookie: request.headers.cookie, origin: request.headers.origin, csrfToken: request.headers['x-csrf-token'] },
      (tx, account) => this.activities.change(tx, id, action, input.reason, account), { write: true })
  }
}
