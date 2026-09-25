import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createApiClient } from '../../../packages/api-client/src/index.js'
import { AppModule } from '../src/app.module.js'

let app: INestApplication
let baseUrl: string

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await app?.close()
})

it('serves the generated client over a real local HTTP connection', async () => {
  const client = createApiClient(baseUrl)
  const { data, error, response } = await client.GET('/api/v1/health')

  expect(response.status).toBe(200)
  expect(error).toBeUndefined()
  expect(data).toEqual({ status: 'ok' })
})
