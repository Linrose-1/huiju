export function activityImages(activity: { imageUrls?: string[]; coverUrl?: string | null }): string[] {
  return activity.imageUrls?.length ? activity.imageUrls : activity.coverUrl ? [activity.coverUrl] : []
}

export function imageSlotsPayload(slots: string[]): string[] {
  if (slots.length > 3) throw new Error('活动图片最多 3 张')
  if (!slots[0] && slots.slice(1).some(Boolean)) throw new Error('请先设置并裁剪封面，再保存活动图片')
  return slots.filter(Boolean)
}

export function cropGeometry(width: number, height: number, frameWidth: number, zoom = 1, x?: number, y?: number) {
  const frameHeight = frameWidth * 4 / 5
  const scale = Math.max(frameWidth / width, frameHeight / height) * Math.min(4, Math.max(1, zoom))
  const displayWidth = width * scale, displayHeight = height * scale
  const left = Math.min(0, Math.max(frameWidth - displayWidth, x ?? (frameWidth - displayWidth) / 2))
  const top = Math.min(0, Math.max(frameHeight - displayHeight, y ?? (frameHeight - displayHeight) / 2))
  return { scale, width: displayWidth, height: displayHeight, x: left, y: top,
    sourceX: -left / scale, sourceY: -top / scale, sourceWidth: frameWidth / scale, sourceHeight: frameHeight / scale }
}
