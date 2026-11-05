import { Body, Controller, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ActivityPosterService } from './poster-service.js'
import { ActivityPosterDto, PosterCodeDto, PosterCopyInput, PosterDraftDto, PosterTargetDto } from './poster-dto.js'

@ApiTags('activity-posters')
@ApiBearerAuth()
@Controller()
export class ActivityPosterController {
  constructor(private readonly posters: ActivityPosterService) {}
  @Get('activities/:id/poster') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: ActivityPosterDto })
  read(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.posters.read(id, header) }
  @Post('organizer/activities/:id/poster-draft') @HttpCode(200) @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: PosterDraftDto })
  draft(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.posters.draft(id, header) }
  @Put('organizer/activities/:id/poster') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: ActivityPosterDto })
  save(@Param('id', ParseUUIDPipe) id: string, @Body() input: PosterCopyInput, @Headers('authorization') header?: string) { return this.posters.save(id, input, header) }
  @Post('activities/:id/poster-code') @HttpCode(200) @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: PosterCodeDto })
  code(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.posters.code(id, header) }
  @Get('activity-posters/resolve/:scene') @Header('Cache-Control', 'no-store') @ApiOperation({ security: [] }) @ApiOkResponse({ type: PosterTargetDto })
  resolve(@Param('scene') scene: string) { return this.posters.resolve(scene) }
}
