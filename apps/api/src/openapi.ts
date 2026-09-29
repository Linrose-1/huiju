import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('会聚 API')
    .setVersion('1.0')
    .addBearerAuth()
    .addCookieAuth('huiju_admin_session', { type: 'apiKey', in: 'cookie' }, 'admin_session')
    .build()

  return SwaggerModule.createDocument(app, config)
}
