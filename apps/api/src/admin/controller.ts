import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common'
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ErrorDto, OkDto } from '../flow/dto.js'
import { AdminAccountDto, AdminAccountListDto, AdminCreateInput, AdminLoginInput, AdminPasswordInput, AdminSessionDto, AdminStatusInput, AdminTemporaryPasswordInput } from './dto.js'
import { AdminService } from './service.js'
import { cookieHeader } from './security.js'

type Response = { setHeader(name: string, value: string): void }
type Request = { socket: { remoteAddress?: string }; headers: { cookie?: string; origin?: string; 'x-csrf-token'?: string } }
const context = (request: Request) => ({ cookie: request.headers.cookie, origin: request.headers.origin, csrfToken: request.headers['x-csrf-token'] })

@Controller('admin') @ApiTags('admin') @ApiCookieAuth('admin_session')
@ApiResponse({ status: 400, type: ErrorDto }) @ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto }) @ApiResponse({ status: 409, type: ErrorDto })
@ApiResponse({ status: 429, type: ErrorDto }) @ApiResponse({ status: 503, type: ErrorDto })
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('auth/login') @HttpCode(200) @Header('Cache-Control', 'no-store') @ApiOperation({ security: [] }) @ApiOkResponse({ type: AdminSessionDto })
  async login(@Body() input: AdminLoginInput, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.admin.login(input.username, input.password, request.headers.origin, request.socket.remoteAddress ?? 'unknown')
    response.setHeader('Set-Cookie', cookieHeader(result.token))
    return result.session
  }
  @Get('auth/session') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: AdminSessionDto })
  session(@Req() request: Request) { return this.admin.requireSession(context(request)) }

  @Post('auth/logout') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.admin.logout(context(request))
    response.setHeader('Set-Cookie', cookieHeader('', true))
    return result
  }
  @Post('auth/password') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  async password(@Body() input: AdminPasswordInput, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.admin.changePassword(context(request), input)
    response.setHeader('Set-Cookie', cookieHeader('', true))
    return result
  }
  @Get('accounts') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: AdminAccountListDto })
  accounts(@Req() request: Request) { return this.admin.listAccounts(context(request)) }

  @Post('accounts') @HttpCode(200) @ApiOkResponse({ type: AdminAccountDto })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  create(@Body() input: AdminCreateInput, @Req() request: Request) { return this.admin.createAccount(context(request), input) }

  @Post('accounts/:id/reset-password') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  reset(@Param('id', ParseUUIDPipe) id: string, @Body() input: AdminTemporaryPasswordInput, @Req() request: Request) { return this.admin.resetPassword(context(request), id, input.temporaryPassword) }

  @Post('accounts/:id/status') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  status(@Param('id', ParseUUIDPipe) id: string, @Body() input: AdminStatusInput, @Req() request: Request) { return this.admin.setStatus(context(request), id, input.active) }
}
