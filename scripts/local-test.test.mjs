import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { assertLocalTestTarget, localWechat, localCode, localAppId, localActors, localIdentityClass } from '../apps/api/scripts/local-test-support.mjs'

test('local test runner refuses production, implicit enablement and non-local databases', () => {
  const env = { NODE_ENV: 'development', DATABASE_URL: 'mysql://test@127.0.0.1:3306/huiju' }
  assert.doesNotThrow(() => assertLocalTestTarget(env, ['--local-test']))
  for (const override of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test' },
    { DATABASE_URL: 'mysql://test@remote.invalid/huiju' },
    { DATABASE_URL: 'mysql://test@127.0.0.1:3307/huiju' },
    { DATABASE_URL: 'mysql://test@127.0.0.1:3306/other' }]) {
    assert.throws(() => assertLocalTestTarget({ ...env, ...override }, ['--local-test']))
  }
  assert.throws(() => assertLocalTestTarget(env, []))
})

test('mock identity stays stable after cache loss and rejects real WeChat codes', async () => {
  const adapter = localWechat(() => { throw new Error('invalid code') })
  assert.deepEqual(await adapter.exchange(localCode), await adapter.exchange(localCode))
  assert.equal(await adapter.phone(localCode), '19900000001')
  await assert.rejects(adapter.exchange('real-code'))
  await assert.rejects(adapter.phone('real-code'))
})

test('seven local actors have stable distinct identities and matching simulated phones', async () => {
  const fail = () => { throw new Error('invalid code') }
  const adapter = localWechat(fail)
  const expectedKeys = ['owner', 'planner', 'operator', 'provider', 'member', 'peer', 'visitor']
  const expectedNames = ['林舟（测试）', '许知夏（测试）', '陈嘉木（测试）', '苏雨禾（测试）',
    '周明远（测试）', '叶青（测试）', '未完善资料（测试）']
  assert.deepEqual(localActors.map(actor => actor.key), expectedKeys)
  const identities = []
  const phones = []
  for (const [index, key] of expectedKeys.entries()) {
    const code = `${localCode}:${key}`
    const identity = await adapter.exchange(code)
    const phone = await adapter.phone(code)
    assert.deepEqual(identity, { appId: localAppId, openId: `local-member-${index + 1}`, unionId: null })
    assert.equal(phone, `1990000000${index + 1}`)
    assert.deepEqual(await localWechat(fail).exchange(code), identity)
    assert.equal(await localWechat(fail).phone(code), phone)
    assert.deepEqual(localActors[index], { key, openId: identity.openId, phone, displayName: expectedNames[index] })
    identities.push(identity.openId)
    phones.push(phone)
  }
  assert.equal(new Set(identities).size, 7)
  assert.equal(new Set(phones).size, 7)
  assert.deepEqual(await adapter.exchange(localCode), await adapter.exchange(`${localCode}:owner`))
  assert.equal(await adapter.phone(localCode), await adapter.phone(`${localCode}:owner`))
})

test('local actor codes reject unknown names and malformed input for identity and phone', async () => {
  const adapter = localWechat((code, message) => {
    assert.equal(code, 'INVALID_INPUT')
    assert.equal(message, '请使用本地测试入口')
    throw new Error('invalid code')
  })
  for (const code of [undefined, null, 1, {}, '', 'real-code', 'huiju-local-test:',
    'huiju-local-test:unknown', 'huiju-local-test:OWNER', 'huiju-local-test:owner:extra',
    ' huiju-local-test:owner', 'huiju-local-test:owner ', 'huiju-local-test:__proto__']) {
    await assert.rejects(adapter.exchange(code), /invalid code/)
    await assert.rejects(adapter.phone(code), /invalid code/)
  }
})

test('test session hashes are distinct from real API hashes', () => {
  const hash = value => createHash('sha256').update(value).digest('hex')
  class Identity { sessionHash(token) { return hash(token) } }
  const Local = localIdentityClass(Identity, hash)
  assert.notEqual(new Local().sessionHash('token'), new Identity().sessionHash('token'))
  assert.equal(new Local().sessionHash('token'), new Local().sessionHash('token'))
  for (const actor of localActors) {
    const token = `session-for-${actor.key}`
    const localHash = new Local().sessionHash(token)
    assert.equal(localHash, hash(`${localAppId}:${token}`))
    assert.notEqual(localHash, new Identity().sessionHash(token))
  }
})
