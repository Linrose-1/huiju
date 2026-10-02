import { Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { OkDto } from '../flow/dto.js'
import { NotificationListDto } from '../flow/organizer-dto.js'
import { PageQuery } from '../flow/pagination.js'
import { NotificationService } from './service.js'

@ApiTags('notifications') @ApiBearerAuth()
@Controller('members/me/notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}
  @Get() @ApiOkResponse({ type: NotificationListDto })
  list(@Query() query: PageQuery, @Headers('authorization') header?: string) { return this.notifications.list(header, query) }
  @Post(':id/read') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  read(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.notifications.read(id, header) }
}
