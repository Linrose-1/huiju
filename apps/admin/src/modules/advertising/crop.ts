export type CropState = { width: number; height: number; ratio: number; zoom: number; x: number; y: number }
export function cropRect(state: CropState) {
  const { width, height, ratio } = state
  const zoom = Math.max(1, Math.min(4, state.zoom))
  const cropWidth = Math.min(width, height * ratio) / zoom
  const cropHeight = cropWidth / ratio
  return { x: Math.max(0, Math.min(width - cropWidth, state.x)), y: Math.max(0, Math.min(height - cropHeight, state.y)), width: cropWidth, height: cropHeight }
}
export function centeredCrop(width: number, height: number, ratio: number, zoom = 1): CropState {
  const rect = cropRect({ width, height, ratio, zoom, x: 0, y: 0 })
  return { width, height, ratio, zoom, x: (width - rect.width) / 2, y: (height - rect.height) / 2 }
}
export function validateImage(file: Pick<File, 'type' | 'size'>) {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('请选择 PNG 或 JPG 图片。')
  if (file.size > 5 * 1024 * 1024) throw new Error('单张图片不能超过 5 MB。')
}
export async function readImage(file: File) {
  validateImage(file)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'))
    reader.readAsDataURL(file)
  })
  const image = new Image()
  image.src = dataUrl
  await image.decode().catch(() => { throw new Error('图片无法解码，请重新选择 PNG/JPG。') })
  if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('图片像素过大，请先缩小至 4000 万像素以内。')
  return { image, dataUrl }
}
