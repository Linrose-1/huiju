import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('会聚 API')
    .setVersion('1.0')
    .addBearerAuth()
    .build()

  return SwaggerModule.createDocument(app, config)
}
