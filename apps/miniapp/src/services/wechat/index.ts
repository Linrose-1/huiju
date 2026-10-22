import { api, ApiError, refreshMember } from '@/services/api'
import { useSessionStore } from '@/stores/session'
import { LOCAL_TEST } from '@/services/api/environment'
import { localTestCode, selectLocalTestActor, type LocalTestActorKey } from '@/services/wechat/local-test-actor'
export { getLocalTestActor, localTestActors, localTestCode } from '@/services/wechat/local-test-actor'
let signingIn: { epoch: number; promise: Promise<void> } | null = null
let switchingActor: Promise<void> | null = null
export function chooseActivityLocation(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    uni.chooseLocation({
      success: result => {
        const address = result.address.trim(), name = result.name.trim()
        const location = !name || address.endsWith(name) ? address : [address, name].filter(Boolean).join(' ')
        if (!location || location.length > 500) { reject(new Error('选点地址为空或超过 500 字，请手动填写')); return }
        resolve(location)
      },
      fail: result => result.errMsg?.includes('cancel') ? resolve(null) : reject(new Error('地图选点未完成，请检查位置权限后重试，也可手动填写地址')),
    })
    // #endif
    // #ifndef MP-WEIXIN
    reject(new Error('请在微信小程序中地图选点，也可手动填写地址'))
    // #endif
  })
}
export function scanActivityCode(): Promise<{ path?: string; result: string } | null> {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    uni.scanCode({ scanType: ['qrCode'],
      success: result => resolve({ path: result.path, result: result.result }),
      fail: result => result.errMsg?.includes('cancel') ? resolve(null) : reject(new Error('扫码未完成，请检查相机权限或从相册选择二维码后重试')) })
    // #endif
    // #ifndef MP-WEIXIN
    reject(new Error('请在微信小程序中扫码'))
    // #endif
  })
}
export async function chooseCover(): Promise<{ base64: string; mimeType: 'image/png' | 'image/jpeg' } | null> {
  // #ifdef MP-WEIXIN
  const path = await new Promise<string | null>((resolve, reject) => {
    uni.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: result => resolve(result.tempFilePaths[0]),
      fail: result => result.errMsg?.includes('cancel') ? resolve(null) : reject(new Error('选图失败，请检查相册权限后重试')) })
  })
  if (!path) return null
  const base64 = await new Promise<string>((resolve, reject) => {
    uni.getFileSystemManager().readFile({ filePath: path, encoding: 'base64', success: result => resolve(String(result.data)), fail: () => reject(new Error('图片读取失败，请重新选择')) })
  })
  if (base64.length > 2796204) throw new Error('请选择不超过 2 MB 的封面')
  const mimeType = base64.startsWith('iVBOR') ? 'image/png' : base64.startsWith('/9j/') ? 'image/jpeg' : null
  if (!mimeType) throw new Error('封面仅支持 PNG 或 JPG 图片')
  return { base64, mimeType }
  // #endif
  // #ifndef MP-WEIXIN
  throw new Error('请在微信小程序中选择封面')
  // #endif
}
export function loginWithWechat(consent: { termsVersion: string; privacyVersion: string }): Promise<void> {
  if (!consent?.termsVersion || !consent?.privacyVersion) return Promise.reject(new ApiError('LEGAL_CONSENT_REQUIRED', '请先阅读并同意用户协议和隐私政策'))
  return bootstrapIdentity().then(() => api.acceptLegal(consent)).then(() => undefined)
}
function identifyWithWechat(): Promise<void> {
  const session = useSessionStore()
  if (signingIn?.epoch === session.epoch) return signingIn.promise
  const epoch = session.epoch
  const inviteCode = session.pendingInvite
  session.identifying = true
  const promise = new Promise<string>((resolve, reject) => {
    if (LOCAL_TEST) { resolve(localTestCode()); return }
    // #ifdef MP-WEIXIN
    uni.login({ provider: 'weixin', success: result => result.code ? resolve(result.code) : reject(new Error('微信没有返回登录凭证，请重试')), fail: () => reject(new Error('微信登录未完成，请重试')) })
    // #endif
    // #ifndef MP-WEIXIN
    reject(new Error('请在微信小程序中登录；当前预览不支持微信授权'))
    // #endif
  }).then(code => {
    if (epoch !== session.epoch) throw new ApiError('STALE_REQUEST', '身份已变更，请重新登录')
    return api.identify(code, inviteCode || undefined)
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
  return identifyWithWechat()
}
export function switchLocalTestActor(key: LocalTestActorKey): Promise<void> {
  if (!LOCAL_TEST) return Promise.reject(new Error('仅本地模拟测试可切换身份'))
  if (switchingActor) return switchingActor
  selectLocalTestActor(key)
  const session = useSessionStore()
  session.clear()
  session.pendingInvite = ''
  const promise = bootstrapIdentity().finally(() => { if (switchingActor === promise) switchingActor = null })
  switchingActor = promise
  return promise
}
export function showActivityShareMenu() {
  // #ifdef MP-WEIXIN
  uni.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
  // #endif
}
export async function uploadAvatar(path: string) {
  const session = useSessionStore()
  const token = session.token, epoch = session.epoch
  // #ifdef MP-WEIXIN
  const base64 = await new Promise<string>((resolve, reject) => {
    uni.getFileSystemManager().readFile({ filePath: path, encoding: 'base64', success: result => resolve(String(result.data)), fail: () => reject(new Error('头像读取失败，请重新选择')) })
  })
  if (base64.length > 2796204) throw new Error('请选择不超过 2 MB 的头像')
  const mimeType = base64.startsWith('iVBOR') ? 'image/png' : base64.startsWith('/9j/') ? 'image/jpeg' : null
  if (!mimeType) throw new Error('头像仅支持 PNG 或 JPG 图片')
  if (token !== session.token || epoch !== session.epoch) throw new ApiError('STALE_REQUEST', '身份已变更，请重新选择头像')
  return api.avatar(base64, mimeType)
  // #endif
  // #ifndef MP-WEIXIN
  throw new Error('请在微信小程序中选择头像')
  // #endif
}
