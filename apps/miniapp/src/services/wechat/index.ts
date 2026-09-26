import { api, ApiError, refreshMember } from '@/services/api'
import { useSessionStore } from '@/stores/session'
let signingIn: { epoch: number; promise: Promise<void> } | null = null
export function loginWithWechat(): Promise<void> {
  const session = useSessionStore()
  if (signingIn?.epoch === session.epoch) return signingIn.promise
  const epoch = session.epoch
  const inviteCode = session.pendingInvite
  session.identifying = true
  const promise = new Promise<string>((resolve, reject) => {
    // #ifdef MP-WEIXIN
    uni.login({ provider: 'weixin', success: result => result.code ? resolve(result.code) : reject(new Error('微信没有返回登录凭证，请重试')), fail: () => reject(new Error('微信登录未完成，请重试')) })
    // #endif
    // #ifndef MP-WEIXIN
    reject(new Error('请在微信小程序中登录；当前预览不支持微信授权'))
    // #endif
  }).then(code => {
    if (epoch !== session.epoch) throw new ApiError('STALE_REQUEST', '身份已变更，请重新登录')
    return api.login(code, inviteCode || undefined)
  }).then(result => {
    if (epoch !== session.epoch) throw new ApiError('STALE_REQUEST', '身份已变更，请重新登录')
    session.accept(result)
  }).finally(() => {
    if (signingIn?.promise === promise) { signingIn = null; session.identifying = false }
  })
  signingIn = { epoch, promise }
  return promise
}
export async function bootstrapIdentity(): Promise<void> {
  const session = useSessionStore()
  if (session.token) {
    try { await refreshMember(); return }
    catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error }
  }
  await loginWithWechat()
}
export async function uploadAvatar(path: string) {
  // #ifdef MP-WEIXIN
  const base64 = await new Promise<string>((resolve, reject) => {
    uni.getFileSystemManager().readFile({ filePath: path, encoding: 'base64', success: result => resolve(String(result.data)), fail: () => reject(new Error('头像读取失败，请重新选择')) })
  })
  if (base64.length > 2796204) throw new Error('请选择不超过 2 MB 的头像')
  const mimeType = base64.startsWith('iVBOR') ? 'image/png' : base64.startsWith('/9j/') ? 'image/jpeg' : null
  if (!mimeType) throw new Error('头像仅支持 PNG 或 JPG 图片')
  return api.avatar(base64, mimeType)
  // #endif
  // #ifndef MP-WEIXIN
  throw new Error('请在微信小程序中选择头像')
  // #endif
}
