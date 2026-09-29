import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AdminModerationController } from '../src/admin/moderation-controller.js'
import { AdminService } from '../src/admin/service.js'
import { FlowDatabase, SafeExceptionFilter } from '../src/flow/common.js'
import { FeedbackService } from '../src/flow/feedback.js'

describe('admin moderation protocol boundary (no database)', () => {
  let app: INestApplication, base: string
  const databaseAccess = vi.fn(() => { throw new Error('No test database configured') })
  const feedback = { listForModeration: vi.fn(), hideForModeration: vi.fn() }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [AdminModerationController], providers: [AdminService,
      { provide: FlowDatabase, useValue: { get db() { return databaseAccess() } } },
      { provide: FeedbackService, useValue: feedback },
    ] }).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api/v1')
    app.useGlobalFilters(new SafeExceptionFilter())
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/admin/feedback`
  })
  afterAll(async () => { await app?.close() })

  it('rejects anonymous and member bearer authentication before reading private data', async () => {
    for (const headers of [{}, { Authorization: 'Bearer member-token' }] as Record<string, string>[]) {
      const response = await fetch(base, { headers })
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ code: 'ADMIN_SESSION_REQUIRED' })
    }
    expect(databaseAccess).not.toHaveBeenCalled()
    expect(feedback.listForModeration).not.toHaveBeenCalled()
  })

  it('rejects malformed kinds and blank moderation reasons at HTTP validation', async () => {
    for (const [kind, reason] of [['unknown', '原因'], ['comment', '   ']]) {
      const response = await fetch(`${base}/${kind}/12345678-1234-4234-8234-123456789abc/hide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) })
      expect(response.status).toBe(400)
    }
    expect(feedback.hideForModeration).not.toHaveBeenCalled()
  })
})
