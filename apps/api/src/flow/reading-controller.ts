import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ErrorDto, OkDto } from './dto.js'
import { RecordViewInput, ReadingListDto, ReadersQuery, ReadingStatsDto } from './reading-dto.js'
import { ReadingService } from './reading.js'

@ApiTags('活动阅读')
@ApiBearerAuth()
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 404, type: ErrorDto })
@ApiResponse({ status: 409, type: ErrorDto })
@ApiResponse({ status: 500, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@Controller('activities/:id')
export class ReadingController {
  constructor(private readonly reading: ReadingService) {}

  @Post('views')
  @HttpCode(200)
  @ApiOperation({ security: [{}, { bearer: [] }] })
  @ApiOkResponse({ type: OkDto })
  record(@Param('id', ParseUUIDPipe) id: string, @Body() body: RecordViewInput, @Headers('authorization') header?: string) {
    return this.reading.record(id, body, header)
  }

  @Get('readers')
  @ApiOperation({ security: [] })
  @ApiOkResponse({ type: ReadingListDto })
  readers(@Param('id', ParseUUIDPipe) id: string, @Query() query: ReadersQuery) {
    return this.reading.readers(id, query.offset)
  }

  @Get('view-stats')
  @ApiOkResponse({ type: ReadingStatsDto })
  stats(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) {
    return this.reading.stats(id, header)
  }
}
