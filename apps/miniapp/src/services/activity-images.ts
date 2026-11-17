export function activityImages(activity: { imageUrls?: string[]; coverUrl?: string | null }): string[] {
  return activity.imageUrls?.length ? activity.imageUrls : activity.coverUrl ? [activity.coverUrl] : []
}

export function imageSlotsPayload(slots: string[]): string[] {
  if (slots.length > 9) throw new Error('活动图片最多 9 张')
  if (!slots[0] && slots.slice(1).some(Boolean)) throw new Error('请先设置并裁剪封面，再保存活动图片')
  return slots.filter(Boolean)
}

export function cropGeometry(width: number, height: number, frameWidth: number, zoom = 1, x?: number, y?: number) {
  const frameHeight = frameWidth * 4 / 5
  const coverScale = Math.max(frameWidth / width, frameHeight / height)
  const minZoom = Math.min(frameWidth / width, frameHeight / height) / coverScale
  const scale = coverScale * Math.min(4, Math.max(minZoom, zoom))
  const displayWidth = width * scale, displayHeight = height * scale
  const left = displayWidth < frameWidth ? (frameWidth - displayWidth) / 2 : Math.min(0, Math.max(frameWidth - displayWidth, x ?? (frameWidth - displayWidth) / 2))
  const top = displayHeight < frameHeight ? (frameHeight - displayHeight) / 2 : Math.min(0, Math.max(frameHeight - displayHeight, y ?? (frameHeight - displayHeight) / 2))
  const sourceWidth = Math.min(width, frameWidth / scale), sourceHeight = Math.min(height, frameHeight / scale)
  const outputScale = 1250 / frameWidth
  return { minZoom, scale, width: displayWidth, height: displayHeight, x: left, y: top,
    sourceX: Math.max(0, -left / scale), sourceY: Math.max(0, -top / scale), sourceWidth, sourceHeight,
    destX: Math.max(0, left) * outputScale, destY: Math.max(0, top) * outputScale,
    destWidth: sourceWidth * scale * outputScale, destHeight: sourceHeight * scale * outputScale }
}
