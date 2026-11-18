import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put, Req, StreamableFile } from '@nestjs/common'
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AdminService } from '../admin/service.js'
import { ErrorDto } from '../flow/dto.js'
import { BrandDto, BrandImageDto, BrandImageInput, BrandInput, PublicBrandAppearanceDto, PublicBrandDto } from './brand-dto.js'
import { BrandService } from './brand-service.js'

@Controller('platform/brand') @ApiTags('platform')
export class PublicBrandController {
  constructor(private readonly brand: BrandService) {}
  @Get() @Header('Cache-Control', 'no-store') @ApiOperation({ security: [] }) @ApiOkResponse({ type: PublicBrandDto })
  read() { return this.brand.publicBrand() }
}

@Controller('platform/appearance') @ApiTags('platform')
export class PublicBrandAppearanceController {
  constructor(private readonly brand: BrandService) {}
  @Get() @Header('Cache-Control', 'no-store') @ApiOperation({ security: [] }) @ApiOkResponse({ type: PublicBrandAppearanceDto })
  appearance() { return this.brand.publicAppearance() }

  @Get('images/:id') @Header('Cache-Control', 'no-store') @Header('X-Content-Type-Options', 'nosniff') @ApiOperation({ security: [] })
  @ApiOkResponse({ content: { 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 404, type: ErrorDto })
  async image(@Param('id', ParseUUIDPipe) id: string) {
    const image = await this.brand.readImage(id)
    return new StreamableFile(image.bytes, { type: image.mimeType })
  }
}

type Request = { headers: { cookie?: string; origin?: string; 'x-csrf-token'?: string } }
const context = (request: Request) => ({ cookie: request.headers.cookie, origin: request.headers.origin, csrfToken: request.headers['x-csrf-token'] })

@Controller('admin/platform/brand') @ApiTags('admin-platform') @ApiCookieAuth('admin_session')
@ApiResponse({ status: 400, type: ErrorDto }) @ApiResponse({ status: 401, type: ErrorDto }) @ApiResponse({ status: 403, type: ErrorDto })
export class AdminBrandController {
  constructor(private readonly brand: BrandService, private readonly admin: AdminService) {}
  @Get() @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: BrandDto })
  read(@Req() request: Request) {
    return this.admin.withSession(context(request), tx => this.brand.read(tx), { superOnly: true })
  }
  @Put() @Header('Cache-Control', 'no-store') @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: BrandDto }) @ApiResponse({ status: 409, type: ErrorDto })
  save(@Body() input: BrandInput, @Req() request: Request) {
    return this.admin.withSession(context(request), (tx, account) => this.brand.save(tx, input, account.id), { write: true, superOnly: true })
  }
  @Post('images') @Header('Cache-Control', 'no-store') @ApiHeader({ name: 'X-CSRF-Token', required: true }) @ApiCreatedResponse({ type: BrandImageDto })
  uploadImage(@Body() input: BrandImageInput, @Req() request: Request) {
    return this.admin.withSession(context(request), (tx, account) => this.brand.uploadImage(tx, input, account.id), { write: true, superOnly: true })
  }
  @Get('images/:id') @Header('Cache-Control', 'private, no-store') @Header('X-Content-Type-Options', 'nosniff')
  @ApiOkResponse({ content: { 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 404, type: ErrorDto })
  image(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.admin.withSession(context(request), async tx => {
      const image = await this.brand.readImage(id, tx, true)
      return new StreamableFile(image.bytes, { type: image.mimeType })
    }, { superOnly: true })
  }
}
