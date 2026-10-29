import { Controller, Get, Header, Headers, Param, ParseUUIDPipe, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { ConnectionPathDto, ConnectionQuery, FellowListDto } from './fellows-dto.js'
import { FellowsService } from './fellows.js'
import { PageQuery } from './pagination.js'

@ApiTags('fellows') @ApiBearerAuth()
@Controller('members')
export class FellowsController {
  constructor(private readonly fellows: FellowsService) {}

  @Get('me/fellows') @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: FellowListDto })
  list(@Query() query: PageQuery, @Headers('authorization') header?: string) { return this.fellows.list(query, header) }

  @Get(':id/connection-path') @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: ConnectionPathDto })
  path(@Param('id', ParseUUIDPipe) id: string, @Query() query: ConnectionQuery, @Headers('authorization') header?: string) { return this.fellows.path(id, query, header) }
}
