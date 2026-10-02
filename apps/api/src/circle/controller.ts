import { Body, Controller, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AvatarInput, ErrorDto, OkDto } from '../flow/dto.js'
import { PageQuery } from '../flow/pagination.js'
import { CircleService } from './service.js'
import { CircleImageDto, CircleIntentInput, CircleIntentListDto, CircleListDto, CirclePostDto, CircleQuery, CircleWriteInput } from './dto.js'
@ApiTags('circle') @ApiBearerAuth()
@ApiResponse({ status: 400, type: ErrorDto }) @ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto }) @ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 409, type: ErrorDto })
@Controller('circle')
export class CircleController {
  constructor(private readonly circle: CircleService) {}
  @Get('posts') @Header('Cache-Control', 'no-store') @ApiOperation({ security: [] }) @ApiOkResponse({ type: CircleListDto })
  list(@Query() q: CircleQuery) { return this.circle.list(q) }
  @Get('mine') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: CircleListDto })
  mine(@Query() q: CircleQuery, @Headers('authorization') h?: string) { return this.circle.list(q, h, true) }
  @Post('posts') @Header('Cache-Control', 'no-store') @HttpCode(200) @ApiOkResponse({ type: CirclePostDto })
  create(@Body() body: CircleWriteInput, @Headers('authorization') h?: string) { return this.circle.save(body, h) }
  @Get('posts/:id') @Header('Cache-Control', 'no-store') @ApiOperation({ security: [] }) @ApiOkResponse({ type: CirclePostDto })
  detail(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') h?: string) { return this.circle.detail(id, h) }
  @Get('posts/:id/manage') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: CirclePostDto })
  manage(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') h?: string) { return this.circle.detail(id, h, true) }
  @Post('posts/:id/edit') @Header('Cache-Control', 'no-store') @HttpCode(200) @ApiOkResponse({ type: CirclePostDto })
  edit(@Param('id', ParseUUIDPipe) id: string, @Body() body: CircleWriteInput, @Headers('authorization') h?: string) { return this.circle.save(body, h, id) }
  @Post('posts/:id/end') @Header('Cache-Control', 'no-store') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  end(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') h?: string) { return this.circle.end(id, h) }
  @Post('posts/:id/intents') @Header('Cache-Control', 'no-store') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  intent(@Param('id', ParseUUIDPipe) id: string, @Body() body: CircleIntentInput, @Headers('authorization') h?: string) { return this.circle.intent(id, body, h) }
  @Get('posts/:id/intents') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: CircleIntentListDto })
  intents(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery, @Headers('authorization') h?: string) { return this.circle.intents(id, q, h) }
  @Post('images') @Header('Cache-Control', 'no-store') @HttpCode(200) @ApiOkResponse({ type: CircleImageDto })
  upload(@Body() body: AvatarInput, @Headers('authorization') h?: string) { return this.circle.upload(body, h) }
  @Get('images/:id') @Header('Cache-Control', 'no-store') @ApiOperation({ security: [] }) @Header('X-Content-Type-Options', 'nosniff')
  async image(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') h?: string) {
    const image = await this.circle.image(id, h)
    return new StreamableFile(image.bytes, { type: image.type, disposition: 'inline', length: image.bytes.length })
  }
}
