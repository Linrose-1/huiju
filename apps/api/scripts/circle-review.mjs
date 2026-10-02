import 'reflect-metadata'
import process from 'node:process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'mysql2/promise'
import { Test } from '@nestjs/testing'
import { circleReviewOptions } from './circle-review-support.mjs'
import { localWechat,localIdentityClass } from './local-test-support.mjs'
async function main() {
  process.env.NODE_ENV ??= 'development'
  const options=circleReviewOptions(process.env,process.argv)
  // Change process-local configuration before importing the application. Never migrate or prepare this database.
  process.env.DATABASE_URL=options.url
  process.env.LOCAL_CIRCLE_DIRECTORY=join(tmpdir(),'huiju-circle-review-20260930')
  const connection=await createConnection({uri:options.url,timezone:'Z'})
  try {
    const [rows]=await connection.query('SELECT COUNT(*) AS count FROM __drizzle_migrations')
    if(Number(rows[0].count)!==9) throw new Error('Review database must already contain migrations 0000–0008')
    await connection.query('SELECT id FROM circle_posts LIMIT 0')
  } finally {await connection.end()}
  const {AppModule}=await import('../dist/app.module.js')
  const {WechatAdapter}=await import('../dist/flow/wechat.js')
  const {IdentityService,tokenHash}=await import('../dist/flow/identity.js')
  const {FlowDatabase,fail}=await import('../dist/flow/common.js')
  const base=localWechat(fail)
  const adapter={...base,exchange:async code=>({...await base.exchange(code),appId:'huiju-circle-review',openId:'circle-review-'+options.actor}),phone:async code=>{await base.phone(code);return options.actor==='author'?'19900000011':'19900000012'}}
  const LocalIdentity=localIdentityClass(IdentityService,tokenHash)
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(WechatAdapter).useValue(adapter).overrideProvider(IdentityService).useFactory({factory:database=>new LocalIdentity(database,adapter),inject:[FlowDatabase]}).compile()
  const app=module.createNestApplication()
  app.setGlobalPrefix('api/v1');app.useBodyParser('json',{limit:'3mb'})
  await app.listen(options.port,'127.0.0.1')
  process.stdout.write(`CIRCLE REVIEW ${options.actor}: http://127.0.0.1:${options.port}/api/v1; isolated huiju_circle_test_20260930, simulated identity/phone. No migration.\n`)
  const close=async()=>{await app.close();process.exit(0)}
  process.once('SIGINT',close);process.once('SIGTERM',close)
}
main().catch(error=>{process.stderr.write(error.code ? `Circle review failed (${error.code}); no migration performed.\n` : `Circle review failed: ${error.message}\n`);process.exitCode=1})
