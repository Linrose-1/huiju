import { api, ApiError } from '@/services/api'
import { API_BASE_URL } from '@/services/api/environment'
import { useSessionStore } from '@/stores/session'

export async function chooseWechatQr() {
  const session = useSessionStore(), token = session.token, epoch = session.epoch
  const path = await new Promise<string | null>((resolve, reject) => {
    uni.chooseImage({ count: 1, sizeType: ['original'], sourceType: ['album'],
      success: result => resolve(result.tempFilePaths[0]),
      fail: result => result.errMsg?.includes('cancel') ? resolve(null) : reject(new Error('选图失败，请重试')) })
  })
  if (!path) return null
  const base64 = await new Promise<string>((resolve, reject) => {
    uni.getFileSystemManager().readFile({ filePath: path, encoding: 'base64', success: result => resolve(String(result.data)), fail: () => reject(new Error('图片读取失败，请重新选择')) })
  })
  if (base64.length > 2796204) throw new Error('请选择不超过 2 MB 的二维码图片')
  const mimeType = base64.startsWith('iVBOR') ? 'image/png' : base64.startsWith('/9j/') ? 'image/jpeg' : null
  if (!mimeType) throw new Error('二维码图片仅支持 PNG 或 JPG')
  if (!token || token !== session.token || epoch !== session.epoch) throw new ApiError('STALE_REQUEST', '身份已变更，请重新选择图片')
  return api.uploadWechatQr(base64, mimeType)
}

export async function downloadWechatQr(path: string): Promise<string> {
  // Never forward the session credential to an arbitrary URL supplied as image data.
  if (!/^\/api\/v1\/members\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/wechat-qr$/.test(path)) throw new Error('二维码链接无效')
  const session = useSessionStore(), token = session.token, epoch = session.epoch
  if (!token) throw new Error('请先登录后查看二维码')
  const result = await new Promise<UniApp.DownloadSuccessData>((resolve, reject) => {
    uni.downloadFile({ url: API_BASE_URL + path.slice('/api/v1'.length), header: { Authorization: `Bearer ${token}` },
      success: resolve, fail: () => reject(new Error('二维码加载失败，请重试')) })
  })
  if (token !== session.token || epoch !== session.epoch) throw new Error('身份已变更，请重新查看')
  if (result.statusCode !== 200) throw new Error('二维码暂不可查看，可能已被移除或关闭公开')
  return result.tempFilePath
}
