import { URL } from 'node:url'
// Imported only by the explicit local test runner, never by the production app.
export const localCode = 'huiju-local-test'
export const localAppId = 'huiju-local-test-v1'
export const localActors = [
  { key: 'owner', openId: 'local-member-1', phone: '19900000001', displayName: '林舟（测试）' },
  { key: 'planner', openId: 'local-member-2', phone: '19900000002', displayName: '许知夏（测试）' },
  { key: 'operator', openId: 'local-member-3', phone: '19900000003', displayName: '陈嘉木（测试）' },
  { key: 'provider', openId: 'local-member-4', phone: '19900000004', displayName: '苏雨禾（测试）' },
  { key: 'member', openId: 'local-member-5', phone: '19900000005', displayName: '周明远（测试）' },
  { key: 'peer', openId: 'local-member-6', phone: '19900000006', displayName: '叶青（测试）' },
  { key: 'visitor', openId: 'local-member-7', phone: '19900000007', displayName: '未完善资料（测试）' }
]

export function assertLocalTestTarget(env, args) {
  if (env.NODE_ENV !== 'development' || !args.includes('--local-test')) {
    throw new Error('Local test requires NODE_ENV=development and --local-test')
  }
  const target = new URL(env.DATABASE_URL || 'invalid:')
  if (target.protocol !== 'mysql:' || target.hostname !== '127.0.0.1'
    || (target.port && target.port !== '3306') || target.pathname !== '/huiju') {
    throw new Error('Local test only supports the authorized 127.0.0.1:3306/huiju database')
  }
}

export function localWechat(fail) {
  function check(code) {
    const actor = localActors.find(actor => code === `${localCode}:${actor.key}`
      || (code === localCode && actor.key === 'owner'))
    if (!actor) fail('INVALID_INPUT', '请使用本地测试入口')
    return actor
  }
  return {
    async exchange(code) {
      const actor = check(code)
      return { appId: localAppId, openId: actor.openId, unionId: null }
    },
    async phone(code) {
      return check(code).phone
    }
  }
}

export function localIdentityClass(IdentityService, tokenHash) {
  return class LocalIdentityService extends IdentityService {
    // Tokens from this process cannot authenticate with the normal API, or vice versa.
    sessionHash(token) { return tokenHash(`${localAppId}:${token}`) }
  }
}
