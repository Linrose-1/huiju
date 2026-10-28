import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MemberCardController } from '../src/flow/member-card-controller.js'
import { MemberCardService } from '../src/flow/member-card.js'

describe('private member QR HTTP contract (service substitute)', () => {
  let app: INestApplication, base: string
  const id = '00000000-0000-4000-8000-000000000001'
  const service = {
    wechatQr: vi.fn(async () => ({ bytes: Buffer.from('private-qr'), type: 'image/png' })),
    saveWechatQr: vi.fn(async () => ({ wechatQrUrl: `/api/v1/members/${id}/wechat-qr` })),
    removeWechatQr: vi.fn(async () => ({ wechatQrUrl: null })),
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [MemberCardController], providers: [{ provide: MemberCardService, useValue: service }] }).compile()
    app = module.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/members`
  })
  afterAll(async () => { await app.close() })
  it('streams bytes without public caching and forwards authorization to the domain service', async () => {
    const response = await fetch(`${base}/${id}/wechat-qr`, { headers: { authorization: 'Bearer test' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('private-qr')
    expect(service.wechatQr).toHaveBeenLastCalledWith(id, 'Bearer test')
  })
  it('validates image payloads and target IDs, and DELETE forwards only the caller identity', async () => {
    expect((await fetch(`${base}/bad-id/wechat-qr`)).status).toBe(400)
    const invalid = await fetch(`${base}/me/wechat-qr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base64: 'aGVsbG8=', mimeType: 'image/png', memberId: id }) })
    expect(invalid.status).toBe(400); expect(service.saveWechatQr).not.toHaveBeenCalled()
    const deleted = await fetch(`${base}/me/wechat-qr`, { method: 'DELETE', headers: { authorization: 'Bearer owner' } })
    expect(deleted.status).toBe(200); expect(await deleted.json()).toEqual({ wechatQrUrl: null })
    expect(service.removeWechatQr).toHaveBeenLastCalledWith('Bearer owner')
  })
})
