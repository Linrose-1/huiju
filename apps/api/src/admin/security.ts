import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { fail } from '../flow/common.js'

export const ADMIN_COOKIE = 'huiju_admin_session'
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const csrfFor = (token: string) => digest(`huiju-admin-csrf:${token}`)
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key))
})
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString('hex')}`
}
export async function verifyPassword(password: string, encoded: string) {
  const [version, salt, key] = encoded.split('$')
  if (version !== 'scrypt-v1' || !salt || !/^[a-f0-9]{32}$/.test(salt) || !key || !/^[a-f0-9]{128}$/.test(key)) return false
  return timingSafeEqual(await derive(password, salt), Buffer.from(key, 'hex'))
}
export function checkPassword(password: string) {
  if (password.length < 12 || password.length > 128 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) fail('INVALID_PASSWORD', '密码须为12至128位，包含字母和数字')
}
export function adminOrigin() {
  let origin: URL
  try { origin = new URL(process.env.ADMIN_ORIGIN ?? '') } catch { return fail('ADMIN_NOT_CONFIGURED', '后台访问地址尚未配置', 503) }
  const local = process.env.NODE_ENV !== 'production' && process.env.ADMIN_ALLOW_LOCAL_HTTP === 'true' && origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  if (origin.origin !== process.env.ADMIN_ORIGIN || (origin.protocol !== 'https:' && !local)) fail('ADMIN_NOT_CONFIGURED', '后台访问地址配置无效', 503)
  return { origin: origin.origin, secure: !local }
}
export function checkOrigin(origin?: string) {
  if (origin !== adminOrigin().origin) fail('ADMIN_ORIGIN_REJECTED', '请求来源不受信任', 403)
}
export function cookieHeader(token: string, clear = false) {
  return `${ADMIN_COOKIE}=${token}; Path=/api/v1/admin; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 28800}${adminOrigin().secure ? '; Secure' : ''}`
}
export function readToken(cookie?: string) {
  const matches = (cookie ?? '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${ADMIN_COOKIE}=`))
  const token = matches.length === 1 ? matches[0]!.slice(ADMIN_COOKIE.length + 1) : ''
  if (!/^[a-f0-9]{64}$/.test(token)) fail('ADMIN_SESSION_REQUIRED', '请登录后台', 401)
  return token
}
