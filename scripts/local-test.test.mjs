import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { assertLocalTestTarget, localWechat, localCode, localIdentityClass } from '../apps/api/scripts/local-test-support.mjs'

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

test('test session hashes are distinct from real API hashes', () => {
  const hash = value => createHash('sha256').update(value).digest('hex')
  class Identity { sessionHash(token) { return hash(token) } }
  const Local = localIdentityClass(Identity, hash)
  assert.notEqual(new Local().sessionHash('token'), new Identity().sessionHash('token'))
  assert.equal(new Local().sessionHash('token'), new Local().sessionHash('token'))
})
