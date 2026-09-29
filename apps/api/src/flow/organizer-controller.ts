import { Body, Controller, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, StreamableFile } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AvatarInput, OkDto } from './dto.js'
import { ActivityWriteInput, AttendanceDto, CancelActivityInput, CoverUploadDto, ManagedActivityDto, ManagedActivityListDto, NotificationListDto, OrganizerRosterDto } from './organizer-dto.js'
import { OrganizerService } from './organizer.js'

@ApiTags('organizer')
@ApiBearerAuth()
@Controller()
export class OrganizerController {
  constructor(private readonly organizer: OrganizerService) {}

  @Post('media/covers') @HttpCode(200) @ApiOkResponse({ type: CoverUploadDto })
  uploadCover(@Body() body: AvatarInput, @Headers('authorization') header?: string) { return this.organizer.uploadCover(body, header) }

  @ApiOperation({ security: [] }) @Header('X-Content-Type-Options', 'nosniff')
  @Get('media/covers/:name')
  async coverImage(@Param('name') name: string) {
    const bytes = await this.organizer.coverImage(name)
    return new StreamableFile(bytes, { type: name.endsWith('.png') ? 'image/png' : 'image/jpeg', disposition: 'inline', length: bytes.length })
  }

  @Post('activities') @HttpCode(200) @ApiOkResponse({ type: ManagedActivityDto })
  create(@Body() body: ActivityWriteInput, @Headers('authorization') header?: string) { return this.organizer.create(body, header) }

  @Post('activities/:id/edit') @HttpCode(200) @ApiOkResponse({ type: ManagedActivityDto })
  edit(@Param('id', ParseUUIDPipe) id: string, @Body() body: ActivityWriteInput, @Headers('authorization') header?: string) { return this.organizer.edit(id, body, header) }

  @Post('activities/:id/publish') @HttpCode(200) @ApiOkResponse({ type: ManagedActivityDto })
  publish(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.organizer.publish(id, header) }

  @Get('members/me/activities') @ApiOkResponse({ type: ManagedActivityListDto })
  list(@Headers('authorization') header?: string) { return this.organizer.list(header) }

  @Get('activities/:id/manage') @ApiOkResponse({ type: ManagedActivityDto })
  detail(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.organizer.detail(id, header) }

  @Get('activities/:id/registrations/manage') @ApiOkResponse({ type: OrganizerRosterDto })
  roster(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.organizer.roster(id, header) }

  @Post('activities/:id/registrations/:registrationId/attendance') @HttpCode(200) @ApiOkResponse({ type: AttendanceDto })
  markAttendance(@Param('id', ParseUUIDPipe) id: string, @Param('registrationId', ParseUUIDPipe) registrationId: string, @Headers('authorization') header?: string) { return this.organizer.markAttendance(id, registrationId, header) }

  @Post('activities/:id/cancel') @HttpCode(200) @ApiOkResponse({ type: ManagedActivityDto })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() body: CancelActivityInput, @Headers('authorization') header?: string) { return this.organizer.cancel(id, body.reason, header) }

  @Get('members/me/notifications') @ApiOkResponse({ type: NotificationListDto })
  notifications(@Headers('authorization') header?: string) { return this.organizer.notifications(header) }

  @Post('members/me/notifications/:id/read') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  read(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.organizer.readNotification(id, header) }
}
