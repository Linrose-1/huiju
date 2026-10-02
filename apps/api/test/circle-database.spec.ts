import 'reflect-metadata'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import sharp from 'sharp'
import { and, count, eq, inArray } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { createDatabase } from '../src/database/db.js'
import { members, memberSessions, adminAccounts } from '../src/database/schema/members.js'
import { circlePosts, circleImages, circleIntents } from '../src/database/schema/circle.js'
import { CircleService } from '../src/circle/service.js'
import { CircleController } from '../src/circle/controller.js'
import { CircleWriteInput, CircleQuery } from '../src/circle/dto.js'
import { FlowDatabase, SafeExceptionFilter } from '../src/flow/common.js'
import { IdentityService, tokenHash } from '../src/flow/identity.js'
import { WechatAdapter } from '../src/flow/wechat.js'
async function removeTestDirectory(directory: string) {
  if (!resolve(directory).startsWith(resolve(tmpdir()) + '\\') || !directory.includes('huiju-circle-')) throw new Error('Unexpected temp cleanup target')
  await rm(directory, { recursive: true, force: true })
}
const enabled = process.env.HUIJU_DB_TEST === 'circle-isolated'
describe.skipIf(!enabled)('circle isolated real MySQL and HTTP', () => {
  it('persists and protects posts, images, intents, lifecycle, paging and concurrent retries', async () => {
    const url = process.env.TEST_DATABASE_URL
    if (!url) throw new Error('Explicit TEST_DATABASE_URL required')
    const target = new URL(url)
    if (target.protocol !== 'mysql:' || target.hostname !== '127.0.0.1' || target.port !== '3306' || target.pathname !== '/huiju_circle_test_20260930' || target.search) throw new Error('Dedicated local circle test database required')
    const connection = createDatabase(url), db = connection.db
    const ids = [randomUUID(), randomUUID(), randomUUID()], adminId = randomUUID()
    const tokens = ids.map(() => randomBytes(32).toString('base64url')), headers = tokens.map(t => 'Bearer ' + t)
    const directory = await mkdtemp(join(tmpdir(), 'huiju-circle-'))
    vi.stubEnv('LOCAL_CIRCLE_DIRECTORY', directory)
    let app: INestApplication | undefined
    try {
      const [root] = await db.select().from(members).where(eq(members.kind, 'platform_root')).limit(1)
      if (!root) throw new Error('Prepared isolated platform root required')
      for (let i = 0; i < ids.length; i++) {
        await db.insert(members).values({ id: ids[i]!, memberNumber: 'CT' + ids[i]!.slice(0, 25), inviteCode: ids[i]!.replaceAll('-', ''), inviterMemberId: root.id,
          avatarUrl: '/fixture.png', displayName: '隔离学友' + i, boundPhone: '19900000001', avatarSetByUser: i !== 2, nameSetByUser: true })
        await db.insert(memberSessions).values({ id: randomUUID(), memberId: ids[i]!, tokenHash: tokenHash(tokens[i]!), expiresAt: new Date(Date.now() + 3600000) })
      }
      await db.insert(adminAccounts).values({ id: adminId, displayName: '隔离管理员' })
      const database = { db } as unknown as FlowDatabase
      const identity = new IdentityService(database, { exchange: () => { throw new Error('Real WeChat forbidden') } } as unknown as WechatAdapter)
      const service = new CircleService(database, identity)
      const write = (): CircleWriteInput => ({ requestId: randomUUID(), category: 'park', subtype: 'rent', title: '【隔离测试】资源', body: '完整正文', imageIds: [] })
      await expect(service.save(write(), headers[2])).rejects.toThrow('绑定手机号')
      await expect(service.save(write())).rejects.toThrow('请先登录')
      const base64 = (await sharp({ create: { width: 4, height: 4, channels: 3, background: '#185540' } }).png().toBuffer()).toString('base64')
      const own = await service.upload({ base64, mimeType: 'image/png' }, headers[0]), other = await service.upload({ base64, mimeType: 'image/png' }, headers[1])
      await expect(service.image(own.id)).rejects.toThrow('图片不存在')
      const [before] = await db.select({ value: count() }).from(circlePosts).where(eq(circlePosts.authorId, ids[0]!))
      await expect(service.save({ ...write(), imageIds: [other.id] }, headers[0])).rejects.toThrow('本人上传')
      const [after] = await db.select({ value: count() }).from(circlePosts).where(eq(circlePosts.authorId, ids[0]!)); expect(after!.value).toBe(before!.value)
      const input = { ...write(), imageIds: [own.id] }
      const pair = await Promise.all([service.save(input, headers[0]), service.save(input, headers[0])])
      const id = pair[0]!.id; expect(id).toBe(pair[1]!.id)
      expect((await service.detail(id)).images).toHaveLength(1)
      expect((await service.image(own.id)).bytes.length).toBeGreaterThan(0)
      await expect(service.detail(id, headers[1], true)).rejects.toThrow('仅发布者')
      const interest = { requestId: randomUUID(), phone: '13800000000' }
      await Promise.all([service.intent(id, interest, headers[1]), service.intent(id, interest, headers[1])])
      const [n] = await db.select({ value: count() }).from(circleIntents).where(eq(circleIntents.postId, id)); expect(n!.value).toBe(1)
      await expect(service.intents(id, { limit: 20, offset: 0 }, headers[1])).rejects.toThrow('仅发布者')
      expect((await service.intents(id, { limit: 20, offset: 0 }, headers[0])).items[0]!.phone).toBe(interest.phone)
      expect(JSON.stringify(await service.detail(id))).not.toMatch(/13800000000|19900000001|phone/)
      const [bound] = await db.select({ phone: members.boundPhone }).from(members).where(eq(members.id, ids[1]!)); expect(bound!.phone).toBe('19900000001')
      await db.transaction(tx => service.moderate(tx, id, 'remove', '下架原因', adminId))
      expect(await service.detail(id)).toMatchObject({ state: 'removed', body: '', images: [], author: null, removalReason: null })
      await expect(service.image(own.id)).rejects.toThrow('图片不存在')
      await service.save({ ...input, body: '作者编辑下架内容' }, headers[0], id)
      expect((await service.detail(id)).state).toBe('removed')
      await expect(service.intent(id, { ...interest, requestId: randomUUID() }, headers[1])).rejects.toThrow('不再接收')
      expect(await service.intent(id, interest, headers[1])).toEqual({ ok: true })
      await db.transaction(tx => service.moderate(tx, id, 'restore', '复核通过', adminId))
      expect((await service.detail(id)).body).toBe('作者编辑下架内容')
      await service.end(id, headers[0]); await service.end(id, headers[0])
      expect((await service.detail(id)).state).toBe('ended')
      await expect(service.intent(id, { ...interest, requestId: randomUUID() }, headers[1])).rejects.toThrow('不再接收')
      await expect(service.save(input, headers[0], id)).rejects.toThrow('已结束')
      const history = await db.transaction(tx => service.history(tx, id, { offset: 0, limit: 1 }))
      expect(history.items).toHaveLength(1); expect(history.hasMore).toBe(true)
      const [baseline] = await db.select({ value: count() }).from(circlePosts).where(and(eq(circlePosts.category, 'service'), eq(circlePosts.moderation, 'normal')))
      const fixtureIds: string[] = []
      for (let i = 0; i < 5; i++) fixtureIds.push((await service.save({ ...write(), category: 'service' }, headers[0])).id)
      const q = Object.assign(new CircleQuery(), { limit: 2, category: 'service' })
      const expectedTotal = Number(baseline!.value) + fixtureIds.length, listedIds: string[] = []
      for (let offset = 0; offset < expectedTotal; offset += q.limit) {
        const page = await service.list({ ...q, offset })
        expect(page.items).toHaveLength(Math.min(q.limit, expectedTotal - offset))
        expect(page.hasMore).toBe(offset + q.limit < expectedTotal)
        expect(page.items.every(p => p.category === 'service')).toBe(true)
        listedIds.push(...page.items.map(p => p.id))
      }
      expect(new Set(listedIds).size).toBe(expectedTotal)
      expect(listedIds.filter(postId => fixtureIds.includes(postId)).sort()).toEqual(fixtureIds.sort())
      const module = await Test.createTestingModule({ controllers: [CircleController], providers: [{ provide: CircleService, useValue: service }] }).compile()
      app = module.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })); app.useGlobalFilters(new SafeExceptionFilter())
      await app.listen(0, '127.0.0.1')
      const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`
      expect((await fetch(base + '/circle/posts?category=service&limit=2')).status).toBe(200)
      expect((await fetch(base + '/circle/posts/' + id + '/intents')).status).toBe(401)
      expect((await fetch(base + '/circle/posts/' + id + '/intents', { headers: { authorization: headers[1]! } })).status).toBe(403)
      const ownResponse = await fetch(base + '/circle/posts/' + id + '/intents', { headers: { authorization: headers[0]! } })
      expect(ownResponse.status).toBe(200); expect((await ownResponse.json()).items[0].phone).toBe(interest.phone)
      expect(ownResponse.headers.get('cache-control')).toBe('no-store')
      await db.transaction(tx => service.moderate(tx, id, 'remove', '再次下架', adminId))
      expect((await (await fetch(base + '/circle/posts/' + id)).json()).body).toBe('')
      expect((await fetch(base + own.url)).status).toBe(404)
    } finally {
      await app?.close()
      await db.delete(circlePosts).where(inArray(circlePosts.authorId, ids))
      await db.delete(circleImages).where(inArray(circleImages.ownerId, ids))
      await db.delete(memberSessions).where(inArray(memberSessions.memberId, ids))
      await db.delete(members).where(inArray(members.id, ids))
      await db.delete(adminAccounts).where(eq(adminAccounts.id, adminId))
      await connection.pool.end()
      await removeTestDirectory(directory); vi.unstubAllEnvs()
    }
  }, 30000)
})
