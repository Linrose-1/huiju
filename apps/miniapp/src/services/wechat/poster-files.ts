declare const wx: { env: { USER_DATA_PATH: string } }
import { mediaUrl } from '@/services/api/environment'

export async function posterCoverPath(url: string | null): Promise<string> {
  if (!url) return '/static/huiju/campus.jpg'
  const source = mediaUrl(url)
  if (source.startsWith('/static/')) return source
  return new Promise((resolve, reject) => uni.getImageInfo({ src: source,
    success: result => resolve(result.path), fail: () => reject(new Error('封面加载失败，请重试')) }))
}
export function writePosterCode(base64: string, mimeType: 'image/png' | 'image/jpeg'): Promise<string> {
  if (!base64 || base64.length > 1500000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return Promise.reject(new Error('活动码无效，请重新生成'))
  const path = `${wx.env.USER_DATA_PATH}/activity-poster-code-${Date.now()}-${Math.random().toString(36).slice(2)}.${mimeType === 'image/png' ? 'png' : 'jpg'}`
  return new Promise((resolve, reject) => uni.getFileSystemManager().writeFile({ filePath: path, data: base64, encoding: 'base64',
    success: () => resolve(path), fail: () => reject(new Error('活动码保存失败，请检查存储空间')) }))
}
export function removePosterCode(path: string) {
  if (path) uni.getFileSystemManager().unlink({ filePath: path, fail: () => undefined })
}
export function savePosterImage(path: string): Promise<void> {
  return new Promise((resolve, reject) => uni.saveImageToPhotosAlbum({ filePath: path, success: () => resolve(),
    fail: () => reject(new Error('未保存图片，请检查相册权限后重试')) }))
}
export function sharePosterImage(path: string): Promise<void> {
  // Older clients can still save the exact same image and share it from their album.
  if (!uni.canIUse('showShareImageMenu')) return Promise.reject(new Error('当前微信版本暂不支持直接分享图片，请保存到相册后分享'))
  return new Promise((resolve, reject) => uni.showShareImageMenu({ path, success: () => resolve(),
    fail: result => result.errMsg?.includes('cancel') ? resolve() : reject(new Error('图片分享未完成，可保存到相册后分享')) }))
}
