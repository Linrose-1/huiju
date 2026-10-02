import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { ActivityDraftService } from '../src/ai/service.js'
import { AgentIsHereDraftProvider } from '../src/ai/provider.js'
import { createDatabase } from '../src/database/db.js'
import { members } from '../src/database/schema/members.js'
import { aiActivityDraftReservations, aiActivityDraftUsages } from '../src/database/schema/ai.js'
import { FlowDatabase } from '../src/flow/common.js'
import { IdentityService } from '../src/flow/identity.js'

// Explicitly authorized, already migrated local test database only. No dotenv,
// DATABASE_URL fallback, migration, root creation or real model calls.
const enabled = process.env.HUIJU_DB_TEST === 'ai-concurrency'

function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise<unknown>(yes => { resolve = yes })
  return { promise, resolve }
}

describe.skipIf(!enabled)('AI reservations on real MySQL connections', () => {
  it('releases member locks during model wait and fences old tokens across instances', async () => {
    const url = process.env.TEST_DATABASE_URL
    if (!url) throw new Error('TEST_DATABASE_URL is required')
    const target = new URL(url)
    if (target.protocol !== 'mysql:' || target.hostname !== '127.0.0.1' || target.port !== '3306' || target.pathname !== '/huiju_ai_test') {
      throw new Error('AI concurrency requires separately authorized 127.0.0.1:3306/huiju_ai_test')
    }
    const connection = createDatabase(url)
    const db = connection.db
    const memberId = randomUUID()
    const responses = [deferred(), deferred()]
    const inFlight: Promise<unknown>[] = []
    let memberCreated = false
    try {
      const [root] = await db.select({ id: members.id }).from(members).where(eq(members.kind, 'platform_root')).limit(1)
      if (!root) throw new Error('Pre-existing platform root in the dedicated test database is required')
      await db.insert(members).values({ id: memberId, memberNumber: `AI${memberId.slice(0, 24)}`, inviteCode: memberId.replaceAll('-', ''), inviterMemberId: root.id,
        boundPhone: '19900000001', displayName: 'AI并发测试', avatarUrl: '/fixture.png', avatarSetByUser: true, nameSetByUser: true })
      memberCreated = true
      const [member] = await db.select().from(members).where(eq(members.id, memberId))
      const database = { db } as unknown as FlowDatabase
      const identity = { require: async () => member } as unknown as IdentityService
      const providerOne = { generate: vi.fn(async (): Promise<unknown> => ({ title: '测试草稿' })) }
      const providerTwo = { generate: vi.fn(async (): Promise<unknown> => ({ title: '测试草稿' })) }
      const first = new ActivityDraftService(database, identity, providerOne as unknown as AgentIsHereDraftProvider)
      const second = new ActivityDraftService(database, identity, providerTwo as unknown as AgentIsHereDraftProvider)
      for (let n = 0; n < 4; n++) await first.create('测试')
      providerOne.generate.mockImplementationOnce(() => responses[0].promise)
      const firstCall = first.create('测试')
      const firstResult = firstCall.then(value => ({ value, error: null }), error => ({ value: null, error }))
      inFlight.push(firstResult)
      await vi.waitFor(() => expect(providerOne.generate).toHaveBeenCalledTimes(5))
      const race = await Promise.allSettled([second.create('测试'), second.create('测试')])
      expect(race.every(result => result.status === 'rejected' && result.reason.response?.code === 'AI_GENERATION_IN_PROGRESS')).toBe(true)
      expect(providerTwo.generate).not.toHaveBeenCalled()

      // This independent write must finish while the provider is still unresolved.
      let timer: ReturnType<typeof setTimeout> | undefined
      const update = db.update(members).set({ displayName: 'AI锁已释放' }).where(eq(members.id, memberId)).execute()
      inFlight.push(update)
      try {
        await Promise.race([update, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Member row remains locked during provider wait')), 2000) })])
      } finally { if (timer) clearTimeout(timer) }

      // Expire only this run's reservation, simulating recovery after worker death.
      await db.update(aiActivityDraftReservations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiActivityDraftReservations.memberId, memberId))
      providerTwo.generate.mockImplementationOnce(() => responses[1].promise)
      const secondCall = second.create('测试')
      const secondResult = secondCall.then(value => ({ value, error: null }), error => ({ value: null, error }))
      inFlight.push(secondResult)
      await vi.waitFor(() => expect(providerTwo.generate).toHaveBeenCalledOnce())
      const [replacement] = await db.select().from(aiActivityDraftReservations).where(eq(aiActivityDraftReservations.memberId, memberId))
      responses[0].resolve({ title: '过期结果' })
      expect((await firstResult).error).toMatchObject({ response: { code: 'AI_GENERATION_EXPIRED' } })
      expect(await db.select().from(aiActivityDraftUsages).where(eq(aiActivityDraftUsages.memberId, memberId))).toHaveLength(4)
      expect(await db.select().from(aiActivityDraftReservations).where(eq(aiActivityDraftReservations.memberId, memberId))).toEqual([replacement])
      responses[1].resolve({ title: '有效结果' })
      expect((await secondResult).value?.remainingToday).toBe(0)
      await expect(first.create('测试')).rejects.toMatchObject({ response: { code: 'AI_DAILY_LIMIT' } })
      expect(await db.select().from(aiActivityDraftUsages).where(eq(aiActivityDraftUsages.memberId, memberId))).toHaveLength(5)
      expect(await db.select().from(aiActivityDraftReservations).where(eq(aiActivityDraftReservations.memberId, memberId))).toHaveLength(0)
    } finally {
      responses.forEach(response => response.resolve({ title: '清理待完成请求' }))
      await Promise.allSettled(inFlight)
      try {
        if (memberCreated) {
          await db.delete(aiActivityDraftReservations).where(eq(aiActivityDraftReservations.memberId, memberId))
          await db.delete(aiActivityDraftUsages).where(eq(aiActivityDraftUsages.memberId, memberId))
          await db.delete(members).where(eq(members.id, memberId))
        }
      } finally { await connection.pool.end() }
    }
  }, 30000)
})
