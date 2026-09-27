import { URL } from 'node:url'
// Imported only by the explicit local test runner, never by the production app.
export const localCode = 'huiju-local-test'
export const localAppId = 'huiju-local-test-v1'

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
    if (code !== localCode) fail('INVALID_INPUT', '请使用本地测试入口')
  }
  return {
    async exchange(code) {
      check(code)
      return { appId: localAppId, openId: 'local-member-1', unionId: null }
    },
    async phone(code) {
      check(code)
      return '19900000001'
    }
  }
}

export function localIdentityClass(IdentityService, tokenHash) {
  return class LocalIdentityService extends IdentityService {
    // Tokens from this process cannot authenticate with the normal API, or vice versa.
    sessionHash(token) { return tokenHash(`${localAppId}:${token}`) }
  }
}
