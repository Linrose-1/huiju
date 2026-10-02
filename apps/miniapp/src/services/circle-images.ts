export async function chooseCircleImages(count: number): Promise<{ path: string; base64: string; mimeType: 'image/png' | 'image/jpeg' }[]> {
  // #ifdef MP-WEIXIN
  const paths = await new Promise<string[]>((resolve, reject) => uni.chooseImage({ count: Math.min(6, Math.max(1, count)), sizeType: ['compressed'], sourceType: ['album', 'camera'], success: result => resolve(Array.isArray(result.tempFilePaths) ? result.tempFilePaths : [result.tempFilePaths]), fail: result => result.errMsg?.includes('cancel') ? resolve([]) : reject(new Error('选图失败，请检查相册权限后重试')) }))
  return Promise.all(paths.map(async path => {
    const base64 = await new Promise<string>((resolve, reject) => uni.getFileSystemManager().readFile({ filePath: path, encoding: 'base64', success: result => resolve(String(result.data)), fail: () => reject(new Error('图片读取失败，请重新选择')) }))
    if (base64.length > 2796204) throw new Error('请选择不超过 2 MB 的图片')
    const mimeType = base64.startsWith('iVBOR') ? 'image/png' : base64.startsWith('/9j/') ? 'image/jpeg' : null
    if (!mimeType) throw new Error('图片仅支持 PNG 或 JPG 格式')
    return { path, base64, mimeType }
  }))
  // #endif
  // #ifndef MP-WEIXIN
  throw new Error('请在微信小程序中选择图片')
  // #endif
}
