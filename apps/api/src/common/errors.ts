import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException
} from '@nestjs/common'
import { randomUUID } from 'node:crypto'

export function fail(code: string, message: string, status = 400): never {
  throw new HttpException({
    code,
    message
  }, status)
}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<{
      status(n: number): {
        json(value: unknown): void
      }
    }>()
    const status = error instanceof HttpException ? error.getStatus() : 500
    const body = error instanceof HttpException ? error.getResponse() : null
    const safe = body && typeof body === 'object' && 'code' in body ? body : {
      code: status === 400 ? 'INVALID_INPUT' : 'SERVICE_UNAVAILABLE',

      message: status === 400 ? '提交的信息不完整或格式不正确' : '服务暂时不可用，请稍后重试',
    }
    response.status(status).json({
      ...safe,
      requestId: randomUUID()
    })
  }
}
