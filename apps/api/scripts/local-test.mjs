import 'reflect-metadata'
import process from 'node:process'
import console from 'node:console'
import { Test } from '@nestjs/testing'
import { assertLocalTestTarget, localWechat, localIdentityClass } from './local-test-support.mjs'

process.env.NODE_ENV ??= 'development'
assertLocalTestTarget(process.env, process.argv)
const { AppModule } = await import('../dist/app.module.js')
const { WechatAdapter } = await import('../dist/flow/wechat.js')
const { IdentityService, tokenHash } = await import('../dist/flow/identity.js')
const { FlowDatabase, fail } = await import('../dist/flow/common.js')
const LocalIdentity = localIdentityClass(IdentityService, tokenHash)
const adapter = localWechat(fail)
const module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(WechatAdapter).useValue(adapter)
  .overrideProvider(IdentityService).useFactory({
    factory: database => new LocalIdentity(database, adapter), inject: [FlowDatabase]
  }).compile()
const app = module.createNestApplication()
app.setGlobalPrefix('api/v1')
app.useBodyParser('json', { limit: '3mb' })
await app.listen(3001, '127.0.0.1')
console.log('LOCAL TEST: http://127.0.0.1:3001/api/v1; simulated identity/phone, real local database')
