import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../src/app.module.js'
import { FlowDatabase } from '../src/database/service.js'
import { IdentityService } from '../src/flow/identity.js'

describe('silent identity HTTP contract without database or WeChat', () => {
  let app: INestApplication, base: string
  const session = { token: 'session', expiresAt: '2026-10-26T00:00:00.000Z', member: {
    id: 'visitor', memberNumber: 'HJ20261019000001', inviteCode: 'HJYQM20261019000001', displayName: null,
    avatarUrl: null, boundPhone: null, profileComplete: false,
  } }
  const identify = vi.fn(async () => session)
  const accessed = vi.fn(() => { throw new Error('Contract tests must not access a database') })
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FlowDatabase).useValue({ get db() { return accessed() } })
      .overrideProvider(IdentityService).useValue({ identify }).compile()
    app = module.createNestApplication(); app.setGlobalPrefix('api/v1')
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/auth/wechat/identify`
  })
  beforeEach(() => { vi.clearAllMocks() })
  afterAll(async () => { await app?.close() })
  const post = (body: unknown) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  it('accepts a WeChat code without authentication or agreement fields', async () => {
    const response = await post({ code: 'wx-code' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(session)
    expect(identify).toHaveBeenCalledExactlyOnceWith('wx-code', undefined)
    expect(accessed).not.toHaveBeenCalled()
  })
  it('forwards the first entry invitation source', async () => {
    expect((await post({ code: 'wx-code', inviteCode: 'HJYQM20261019000002' })).status).toBe(200)
    expect(identify).toHaveBeenCalledExactlyOnceWith('wx-code', 'HJYQM20261019000002')
  })
  it.each([
    {}, { code: '' }, { code: 'x'.repeat(513) }, { code: 123 }, { code: 'wx-code', inviteCode: '' },
    { code: 'wx-code', inviteCode: 'x'.repeat(33) }, { code: 'wx-code', inviteCode: 123 },
    { code: 'wx-code', memberId: 'injected' }, { code: 'wx-code', profileComplete: true },
    { code: 'wx-code', termsVersion: 'auto-consent', privacyVersion: 'auto-consent' },
    { code: 'wx-code', openId: 'injected' },
  ])('rejects invalid identity input or injected state: %j', async body => {
    expect((await post(body)).status).toBe(400)
    expect(identify).not.toHaveBeenCalled()
    expect(accessed).not.toHaveBeenCalled()
  })
})
