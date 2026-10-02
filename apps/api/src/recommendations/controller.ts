import { Body, Controller, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { OkDto } from '../flow/dto.js'
import { ActivitySearchService } from './service.js'
import { ActivitySearchInput, ActivitySearchResultDto, SearchImpressionsInput, SearchPageQuery, SearchViewDto, SearchViewInput } from './dto.js'

@ApiTags('ai') @ApiBearerAuth() @Controller('ai/activity-searches')
export class ActivitySearchController {
  constructor(private readonly searches: ActivitySearchService) {}
  @Post() @HttpCode(200) @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: ActivitySearchResultDto })
  create(@Body() input: ActivitySearchInput, @Headers('authorization') header?: string) { return this.searches.create(input, header) }
  @Get(':id') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: ActivitySearchResultDto })
  page(@Param('id', ParseUUIDPipe) id: string, @Query() query: SearchPageQuery, @Headers('authorization') header?: string) { return this.searches.page(id, query.cursor, header) }
  @Post(':id/impressions') @HttpCode(200) @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: OkDto })
  impressions(@Param('id', ParseUUIDPipe) id: string, @Body() input: SearchImpressionsInput, @Headers('authorization') header?: string) { return this.searches.impressions(id, input.activityIds, header) }
  @Post(':id/views') @HttpCode(200) @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: SearchViewDto })
  view(@Param('id', ParseUUIDPipe) id: string, @Body() input: SearchViewInput, @Headers('authorization') header?: string) { return this.searches.view(id, input.activityId, header) }
}
