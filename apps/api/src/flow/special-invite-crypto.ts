import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { fail } from './common.js'

function key() {
  const configured = process.env.ACTIVITY_INVITE_KEY ?? ''
  const value = Buffer.from(configured, 'base64')
  if (value.length !== 32 || value.toString('base64') !== configured) fail('SPECIAL_INVITE_UNAVAILABLE', '特邀码服务暂不可用，请联系管理员', 503)
  return value
}
export function inviteHash(purpose: 'phone' | 'code', value: string) {
  return createHmac('sha256', key()).update(`activity-invite:${purpose}:`).update(value).digest('hex')
}
export function createInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return [...randomBytes(12)].map(value => alphabet[value & 31]).join('')
}
export function sealInvite(id: string, activityId: string, payload: { code: string; phone: string }) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), nonce)
  cipher.setAAD(Buffer.from(`${id}:${activityId}`))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return [nonce, cipher.getAuthTag(), encrypted].map(value => value.toString('base64')).join('.')
}
export function openInvite(row: { id: string; activityId: string; encryptedPayload: string }): { code: string; phone: string } {
  const secret = key()
  try {
    const [nonce, tag, data] = row.encryptedPayload.split('.').map(value => Buffer.from(value, 'base64'))
    const decipher = createDecipheriv('aes-256-gcm', secret, nonce!)
    decipher.setAAD(Buffer.from(`${row.id}:${row.activityId}`))
    decipher.setAuthTag(tag!)
    return JSON.parse(Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8'))
  } catch { fail('SPECIAL_INVITE_UNAVAILABLE', '特邀码服务暂不可用，请联系管理员', 503) }
}
