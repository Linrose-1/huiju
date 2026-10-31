import { Body, Controller, Get, Header, Headers, HttpCode, HttpException, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
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

  @ApiOperation({ security: [{}, { bearer: [] }] })
  @Get('activities/:id/registrations')
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: PublicRosterDto })
  roster(
    @Param('id', ParseUUIDPipe)
    id: string, @Query() query: PageQuery, @Headers('authorization') header?: string) { return this.activity.roster(id, query, header) }

  @Get('activities/:id/registrations/me')
  @ApiOkResponse({ type: RegistrationDto })
  @ApiNoContentResponse({ description: '本人尚未报名此活动' })
  async mine(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Res({ passthrough: true }) response: { status(code: number): unknown },
    @Headers('authorization')
    header?: string) {
    try { return await this.activity.mine(id, header) }
    catch (error) {
      const body = error instanceof HttpException ? error.getResponse() : null
      if (error instanceof HttpException && error.getStatus() === 404 && typeof body === 'object' && body && 'code' in body && body.code === 'REGISTRATION_NOT_FOUND') {
        response.status(204)
        return
      }
      throw error
    }
  }

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
