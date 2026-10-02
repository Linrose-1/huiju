import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ActivityService } from './activity.js'
import { ActivityListQuery } from './activity-list-dto.js'
import { MyRegistrationQuery, PageQuery } from './pagination.js'
import { ActivityDto, ActivityListDto, AnswersInput, ErrorDto, PublicRosterDto, RegistrationDto, RegistrationInput, RegistrationListDto } from './dto.js'

@ApiTags('activities')
@ApiResponse({
  status: 400,
  type: ErrorDto
})
@ApiResponse({
  status: 401,
  type: ErrorDto
})
@ApiResponse({
  status: 403,
  type: ErrorDto
})
@ApiResponse({
  status: 404,
  type: ErrorDto
})
@ApiResponse({
  status: 409,
  type: ErrorDto
})
@ApiResponse({
  status: 500,
  type: ErrorDto
})
@ApiResponse({
  status: 503,
  type: ErrorDto
})
@ApiBearerAuth()
@Controller()
export class FlowController {
  constructor(private readonly activity: ActivityService) {}

  @ApiOperation({ security: [] })
  @Get('activities')
  @ApiOkResponse({ type: ActivityListDto })
  list(@Query() query: ActivityListQuery) { return this.activity.list(query) }

  @ApiOperation({ security: [] })
  @Get('activities/:id')
  @ApiOkResponse({ type: ActivityDto })
  detail(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Headers('authorization')
    header?: string) { return this.activity.detail(id, header) }

  @ApiOperation({ security: [] })
  @Get('activities/:id/registrations')
  @ApiOkResponse({ type: PublicRosterDto })
  roster(
    @Param('id', ParseUUIDPipe)
    id: string, @Query() query: PageQuery) { return this.activity.roster(id, query) }

  @Get('activities/:id/registrations/me')
  @ApiOkResponse({ type: RegistrationDto })
  mine(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Headers('authorization')
    header?: string) { return this.activity.mine(id, header) }

  @Get('members/me/registrations')
  @ApiOkResponse({ type: RegistrationListDto })
  allMine(
    @Query() query: MyRegistrationQuery,
    @Headers('authorization')
    header?: string) { return this.activity.allMine(header, query) }

  @HttpCode(200)
  @Post('activities/:id/registrations')
  @ApiOkResponse({ type: RegistrationDto })
  register(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Body()
    body: RegistrationInput,
    @Headers('authorization')
    header?: string) { return this.activity.write(id, header, 'register', body) }

  @Patch('activities/:id/registrations/me')
  @ApiOkResponse({ type: RegistrationDto })
  edit(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Body()
    body: AnswersInput,
    @Headers('authorization')
    header?: string) { return this.activity.write(id, header, 'edit', body) }

  @HttpCode(200)
  @Post('activities/:id/registrations/me/answers')
  @ApiOkResponse({ type: RegistrationDto })
  editFromMiniapp(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Body()
    body: AnswersInput,
    @Headers('authorization')
    header?: string) { return this.activity.write(id, header, 'edit', body) }

  @HttpCode(200)
  @Post('activities/:id/registrations/me/cancel')
  @ApiOkResponse({ type: RegistrationDto })
  cancel(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Headers('authorization')
    header?: string) { return this.activity.write(id, header, 'cancel') }
}
