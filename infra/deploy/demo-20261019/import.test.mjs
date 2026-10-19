import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { buildPlan, verifyEnvironment, hash } from './import.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const content = JSON.parse(await readFile(resolve(here, 'content.json'), 'utf8'))
const owner = '77777777-7777-5777-a777-777777777777'
const plan = buildPlan(content, owner, '2026-10-19')

test('planning is deterministic, uses Beijing dates, and binds content only to the specified owner', () => {
  assert.deepEqual(plan, buildPlan(content, owner, '2026-10-19'))
  assert.equal(plan.activities.length, 12)
  assert.equal(plan.posts.length, 8)
  assert.equal(plan.activities[0].input.startsAt, '2026-10-21T11:00:00.000Z')
  assert.equal(plan.activities[0].input.registrationDeadline, '2026-10-21T05:00:00.000Z')
  assert.ok(plan.activities.every(a => a.input.coverUrl.startsWith(`/api/v1/media/covers/${owner}_`)))
  const other = buildPlan(content, '88888888-8888-5888-a888-888888888888', '2026-10-19')
  assert.notEqual(plan.activities[0].id, other.activities[0].id)
})

test('bad dates, wrong owners, missing images and lost demo notices are rejected', () => {
  assert.throws(() => buildPlan(content, 'unknown', '2026-10-19'), /会员UUID/)
  assert.throws(() => buildPlan(content, owner, '2026-02-30'), /日期无效/)
  const missing = JSON.parse(JSON.stringify(content)); missing.activities[0].image = 'unavailable'
  assert.throws(() => buildPlan(missing, owner, '2026-10-19'), /图片不存在/)
  assert.throws(() => buildPlan({ ...content, activityNotice: '' }, owner, '2026-10-19'), /演示说明/)
})

test('all four circle categories have two posts and every item discloses the simulation and photograph source', () => {
  for (const category of ['park', 'operation', 'service', 'store']) assert.equal(plan.posts.filter(p => p.input.category === category).length, 2)
  assert.ok(plan.activities.every(a => a.input.description.includes('体验说明') && a.input.description.includes('非本活动') && a.input.registrationNotice.includes('请勿据此到场或付款')))
  assert.ok(plan.posts.every(p => p.input.body.includes('体验说明') && p.input.body.includes('非本资源') && p.input.body.includes('/ Unsplash')))
  assert.ok(plan.posts.filter(p => p.input.category === 'store').every(p => p.input.storeName.includes('演示')))
})

test('environment guards reject local development, wrong databases and wrong server origins before connecting', () => {
  const env = { NODE_ENV: 'production', DATABASE_URL: 'mysql://demo:example-only@127.0.0.1:3306/huiju', ADMIN_ORIGIN: 'https://106.55.240.34:8443', LOCAL_COVER_DIRECTORY: '/var/lib/huiju/media/covers', LOCAL_CIRCLE_DIRECTORY: '/var/lib/huiju/media/circles' }
  const options = { 'database-target': '127.0.0.1:3306/huiju', 'member-number': 'HJ20261019000001', 'backup-file': '/srv/huiju/backups/before.sql.gz', 'receipt-file': '/srv/huiju/receipts/demo.jsonl' }
  assert.doesNotThrow(() => verifyEnvironment(env, options, 'linux'))
  assert.throws(() => verifyEnvironment(env, options, 'win32'), /服务器Linux/)
  assert.throws(() => verifyEnvironment({ ...env, NODE_ENV: 'development' }, options, 'linux'), /服务器Linux/)
  assert.throws(() => verifyEnvironment({ ...env, DATABASE_URL: 'mysql://demo:example-only@127.0.0.1:3306/another' }, options, 'linux'), /数据库目标/)
  assert.throws(() => verifyEnvironment({ ...env, ADMIN_ORIGIN: 'https://other.invalid' }, options, 'linux'), /服务器入口/)
  assert.throws(() => verifyEnvironment(env, { ...options, 'member-number': '' }, 'linux'), /会员编号/)
})

test('real photographs match recorded checksums and application image/content validation', async () => {
  const apiDist = resolve(here, '../../../apps/api/dist')
  const { validAvatar } = await import(pathToFileURL(resolve(apiDist, 'flow/identity.js')))
  const { activityValues } = await import(pathToFileURL(resolve(apiDist, 'flow/organizer.js')))
  const { postValues } = await import(pathToFileURL(resolve(apiDist, 'circle/service.js')))
  const checksums = JSON.parse(await readFile(resolve(here, 'asset-checksums.json'), 'utf8'))
  for (const a of content.assets) {
    const image = await readFile(resolve(here, a.file))
    assert.equal(hash(image), checksums[a.key])
    await validAvatar({ base64: image.toString('base64'), mimeType: 'image/jpeg' })
  }
  for (const a of plan.activities) {
    assert.doesNotThrow(() => activityValues(a.input))
    assert.ok(a.input.questions.length >= 1)
  }
  for (const p of plan.posts) assert.doesNotThrow(() => postValues(p.input))
})

test('the default CLI only produces a plan without database credentials or a database connection', () => {
  const result = spawnSync(process.execPath, [resolve(here, 'import.mjs'), '--base-date=2026-10-19'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test' } })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.mode, 'plan-only-no-database')
  assert.equal(output.ownerConfirmed, false)
})
