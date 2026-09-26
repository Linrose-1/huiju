import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../dist/app.module.js'
import { createOpenApiDocument } from '../dist/openapi.js'

const projectRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const outputPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(projectRoot, 'docs/api/openapi.json')
const app = await NestFactory.create(AppModule, { logger: false })

try {
  app.setGlobalPrefix('api/v1')
  await app.init()
  const document = createOpenApiDocument(app)
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  process.stdout.write(`OpenAPI written to ${outputPath}\n`)
} finally {
  await app.close()
}
