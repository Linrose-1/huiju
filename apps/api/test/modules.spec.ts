import 'reflect-metadata'
import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js'
import { ModulesContainer } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { describe, expect, it, vi } from 'vitest'
import { AppModule } from '../src/app.module.js'
import { FlowDatabase } from '../src/database/service.js'
import { FlowDatabase as CompatibleDatabase, fail } from '../src/flow/common.js'
import { IdentityService, tokenHash } from '../src/flow/identity.js'
import { IdentityController } from '../src/flow/identity-controller.js'
import { WechatAdapter } from '../src/flow/wechat.js'
import { ActivityService } from '../src/flow/activity.js'
import { OrganizerService } from '../src/flow/organizer.js'
import { ReadingService } from '../src/flow/reading.js'
import { FeedbackService } from '../src/flow/feedback.js'
import { MemberCardService } from '../src/flow/member-card.js'
import { NotificationService } from '../src/notifications/service.js'
import { ActivityDraftService } from '../src/ai/service.js'

function deniedDatabase() {
  const accessed = vi.fn(() => { throw new Error('Assembly test must never access a database') })
  return { database: { get db() { return accessed() } }, accessed }
}

function mountedRoutes(container: ModulesContainer) {
  const routes: string[] = []
  for (const module of container.values()) for (const wrapper of module.controllers.values()) {
    const controller = wrapper.metatype!
    const prefixes = [Reflect.getMetadata(PATH_METADATA, controller) ?? ''].flat()
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const method = controller.prototype[name]
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, method) as RequestMethod | undefined
      if (requestMethod === undefined) continue
      const paths = [Reflect.getMetadata(PATH_METADATA, method) ?? ''].flat()
      for (const prefix of prefixes) for (const path of paths) {
        const url = [prefix, path].join('/').split('/').filter(Boolean).join('/')
        routes.push(`${RequestMethod[requestMethod]} /${url}`)
      }
    }
  }
  return routes
}

describe('API domain module assembly without network or database access', () => {
  it('registers shared providers once and mounts relocated routes without duplicates', async () => {
    const f = deniedDatabase()
    const app = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(FlowDatabase).useValue(f.database).compile()
    try {
      const container = app.get(ModulesContainer)
      for (const token of [FlowDatabase, IdentityService, WechatAdapter, NotificationService]) {
        const providers = [...container.values()].flatMap(module => [...module.providers.values()]).filter(wrapper => wrapper.token === token)
        expect(providers).toHaveLength(1)
        expect(providers[0].instance).toBe(app.get(token))
      }
      expect(CompatibleDatabase).toBe(FlowDatabase)
      const routes = mountedRoutes(container)
      expect(new Set(routes).size).toBe(routes.length)
      expect(routes).toEqual(expect.arrayContaining([
        'POST /auth/wechat/session', 'GET /auth/session', 'DELETE /auth/session',
        'POST /members/me/phone', 'PATCH /members/me/profile', 'POST /members/me/profile',
        'POST /members/me/avatar', 'GET /media/avatars/:name',
        'GET /members/me/notifications', 'POST /members/me/notifications/:id/read',
        'GET /activities', 'GET /activities/:id', 'POST /activities/:id/registrations',
        'POST /activities/:id/registrations/:registrationId/attendance', 'POST /ai/activity-drafts',
      ]))
      expect(f.accessed).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('preserves the local-test factory override across every member-facing domain', async () => {
    // Load the actual local-test helper, but never execute the runner that listens on 3001.
    const support = await import(new URL('../scripts/local-test-support.mjs', import.meta.url).href) as {
      localIdentityClass: (base: typeof IdentityService, hash: typeof tokenHash) => typeof IdentityService
      localWechat: (reject: typeof fail) => WechatAdapter
    }
    const f = deniedDatabase()
    const LocalIdentity = support.localIdentityClass(IdentityService, tokenHash)
    const adapter = support.localWechat(fail)
    const factory = vi.fn((database: FlowDatabase) => new LocalIdentity(database, adapter))
    const app = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FlowDatabase).useValue(f.database)
      .overrideProvider(WechatAdapter).useValue(adapter)
      .overrideProvider(IdentityService).useFactory({ factory, inject: [CompatibleDatabase] }).compile()
    try {
      const identity = app.get(IdentityService)
      expect(identity).toBeInstanceOf(LocalIdentity)
      expect(factory).toHaveBeenCalledExactlyOnceWith(f.database)
      expect(app.get(WechatAdapter)).toBe(adapter)
      const denied = new Error('local-test identity reached')
      const requireIdentity = vi.spyOn(identity, 'require').mockRejectedValue(denied)
      const requests = [
        () => app.get(IdentityController).me('local-token'),
        () => app.get(ActivityService).allMine('local-token'),
        () => app.get(OrganizerService).list('local-token'),
        () => app.get(ReadingService).stats('activity', 'local-token'),
        () => app.get(FeedbackService).context('activity', 'local-token'),
        () => app.get(MemberCardService).profile('local-token'),
        () => app.get(NotificationService).list('local-token'),
        () => app.get(ActivityDraftService).create('活动想法', 'local-token'),
      ]
      for (const request of requests) await expect(request()).rejects.toBe(denied)
      expect(requireIdentity).toHaveBeenCalledTimes(requests.length)
      expect(f.accessed).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
})
