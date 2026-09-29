import { Body, Controller, Get, Header, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common'
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ErrorDto, OkDto } from '../flow/dto.js'
import { FeedbackService } from '../flow/feedback.js'
import { HideFeedbackInput, ModerationListDto, ModerationQuery } from '../flow/moderation-dto.js'
import { AdminService } from './service.js'

enum FeedbackKind { comment = 'comment', review = 'review' }
type AdminRequest = { headers: { cookie?: string; origin?: string; 'x-csrf-token'?: string } }

@ApiTags('admin-moderation') @ApiCookieAuth('admin_session')
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 404, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@Controller('admin/feedback')
export class AdminModerationController {
  constructor(private readonly admin: AdminService, private readonly feedback: FeedbackService) {}

  @Get() @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: ModerationListDto })
  list(@Query() query: ModerationQuery, @Req() request: AdminRequest) {
    return this.admin.withSession({ cookie: request.headers.cookie }, tx => this.feedback.listForModeration(tx, query))
  }

  @Post(':kind/:id/hide') @Header('Cache-Control', 'no-store') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  hide(@Param('kind', new ParseEnumPipe(FeedbackKind)) kind: FeedbackKind,
    @Param('id', ParseUUIDPipe) id: string, @Body() input: HideFeedbackInput, @Req() request: AdminRequest) {
    return this.admin.withSession({ cookie: request.headers.cookie, origin: request.headers.origin, csrfToken: request.headers['x-csrf-token'] },
      (tx, account) => this.feedback.hideForModeration(tx, kind, id, input.reason, account), { write: true })
  }
}
