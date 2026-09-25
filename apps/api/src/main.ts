import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module.js'
import { createOpenApiDocument } from './openapi.js'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))

  SwaggerModule.setup('api/docs', app, () => createOpenApiDocument(app))

  const port = Number(process.env.PORT ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
  await app.listen(port)
}

void bootstrap()
