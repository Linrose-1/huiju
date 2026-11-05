import { activityTimeRange } from '@/services/presentation'

export const POSTER_WIDTH = 750
export const POSTER_HEIGHT = 1450

export interface ActivityPosterData {
  title: string
  subtitle: string
  highlights: string[]
  startsAt: string
  endsAt: string
  location: string
  feeType: 'free' | 'paid'
  /** Same unit as activity.feeAmountCents: integer cents. */
  feeAmount?: number | null
}

type PosterOptions = {
  canvasId: string
  component?: Parameters<typeof uni.createCanvasContext>[1]
  data: ActivityPosterData
  coverPath: string
  codePath: string
  brandName?: string
  brandVisible?: boolean
}
type Context = ReturnType<typeof uni.createCanvasContext>
const green = '#155B45', ink = '#14211D', muted = '#6F7772', margin = 38
const contentWidth = POSTER_WIDTH - margin * 2

function font(context: Context, size: number, bold = false) {
  context.setFontSize(size)
  context.font = `${bold ? 'bold ' : ''}${size}px sans-serif`
}

function lines(context: Context, value: string, width: number): string[] {
  const result: string[] = []
  let current = ''
  for (const character of value.replace(/\s+/gu, ' ').trim()) {
    if (current && context.measureText(current + character).width > width) {
      result.push(current)
      current = character
    } else current += character
  }
  if (current) result.push(current)
  return result
}

function limitedLines(context: Context, value: string, width: number, maximum: number) {
  const result = lines(context, value, width)
  if (result.length <= maximum) return result
  const last = [...result[maximum - 1]]
  while (last.length && context.measureText(last.join('') + '…').width > width) last.pop()
  return [...result.slice(0, maximum - 1), last.join('') + '…']
}

function text(context: Context, value: string, x: number, y: number, size: number, color = ink, bold = false) {
  font(context, size, bold)
  context.setFillStyle(color)
  context.fillText(value, x, y)
}

function rule(context: Context, y: number) {
  context.setStrokeStyle(green)
  context.setLineWidth(1.5)
  context.beginPath()
  context.moveTo(margin, y)
  context.lineTo(POSTER_WIDTH - margin, y)
  context.stroke()
}

async function imageInfo(path: string, label: string) {
  if (!path) throw new Error(`${label}尚未准备好，请重试`)
  return new Promise<{ width: number; height: number; path: string }>((resolve, reject) => {
    uni.getImageInfo({ src: path, success: info => {
      if (!(info.width > 0 && info.height > 0)) { reject(new Error(`${label}尺寸无效，请重试`)); return }
      // WeChat strips the leading slash from packaged assets in getImageInfo.path.
      // Canvas resolves that relative to the page, so retain the caller's package-root path.
      resolve({ ...info, path: path.startsWith('/') ? path : info.path })
    }, fail: () => reject(new Error(`${label}加载失败，请重试`)) })
  })
}

/** Draw only local prepared assets. The caller owns identity, API reads and downloads. */
export async function renderActivityPoster(options: PosterOptions): Promise<string> {
  const { canvasId, component, data } = options
  const [cover, code] = await Promise.all([imageInfo(options.coverPath, '活动封面'), imageInfo(options.codePath, '活动小程序码')])
  const context = uni.createCanvasContext(canvasId, component)
  context.setFillStyle('#F8F7F2')
  context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)
  context.setTextBaseline('top')
  context.setTextAlign('left')

  if (options.brandVisible !== false) {
    const brand = options.brandName?.trim() || '有聚点'
    let size = 34
    font(context, size, true)
    while (size > 18 && context.measureText(brand).width > 470) font(context, --size, true)
    limitedLines(context, brand, 470, 2).forEach((line, index) => text(context, line, margin, 28 + index * 25, size, green, true))
  }
  text(context, '活动邀请', 596, 38, 28)
  rule(context, 88)

  // Preserve the entire allowed title, shrinking it instead of silently truncating it.
  let titleSize = 80
  font(context, titleSize, true)
  let titleLines = lines(context, data.title, contentWidth)
  while ((titleLines.length > 3 || titleLines.length * titleSize * 1.15 > 150) && titleSize > 24) {
    font(context, --titleSize, true)
    titleLines = lines(context, data.title, contentWidth)
  }
  if (titleLines.length > 3) throw new Error('活动标题过长，暂时无法生成海报')
  // Balance a short final line (for example a single trailing Chinese character).
  // Adopt the split only if each line fits; mixed-width titles retain the safe measured wrap.
  const titleCharacters = [...data.title.replace(/\s+/gu, ' ').trim()]
  const charactersPerLine = Math.ceil(titleCharacters.length / titleLines.length)
  const balancedTitle = titleLines.map((_, index) => titleCharacters.slice(index * charactersPerLine, (index + 1) * charactersPerLine).join(''))
  if (balancedTitle.every(line => context.measureText(line).width <= contentWidth)) titleLines = balancedTitle
  titleLines.forEach((line, index) => text(context, line, margin, 112 + index * titleSize * 1.15, titleSize, ink, true))
  const subtitleTop = 112 + titleLines.length * titleSize * 1.15 + 15
  font(context, 26)
  limitedLines(context, data.subtitle, contentWidth, 2).forEach((line, index) => text(context, line, margin, subtitleTop + index * 32, 26))

  // The accepted template uses the original cover cropped centrally to 5:4.
  const coverHeight = contentWidth * 4 / 5
  const scale = Math.max(contentWidth / cover.width, coverHeight / cover.height)
  const sourceWidth = contentWidth / scale, sourceHeight = coverHeight / scale
  context.drawImage(cover.path, (cover.width - sourceWidth) / 2, (cover.height - sourceHeight) / 2, sourceWidth, sourceHeight, margin, 346, contentWidth, coverHeight)
  rule(context, 909)

  const highlights = data.highlights.filter(value => value.trim()).slice(0, 2)
  if (highlights.length) {
    text(context, '本次看点', margin, 938, 34, green, true)
    font(context, 24)
    let y = 932
    for (const highlight of highlights) {
      const rows = limitedLines(context, highlight, 478, 2)
      rows.forEach(line => { text(context, line, 234, y, 24); y += 28 })
      y += 5
    }
  } else {
    text(context, '欢迎一起交流', margin, 948, 34, green, true)
    text(context, '查看活动详情，了解更多信息', margin, 999, 26, muted)
  }

  let informationY = 1070
  const amount = data.feeAmount
  const price = data.feeType === 'free' ? '免费参与'
    : typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? `¥${(amount / 100).toFixed(2)} / 人` : '费用请查看活动详情'
  for (const [label, value, maximum] of [
    ['时间', activityTimeRange(data.startsAt, data.endsAt), 2],
    ['地点', data.location || '地点请查看活动详情', 2],
    ['费用', price, 1],
  ] as const) {
    font(context, 24)
    const rows = limitedLines(context, value, 552, maximum)
    context.setFillStyle('#E5EBE5')
    context.fillRect(margin, informationY - 2, 80, 30)
    text(context, label, margin + 15, informationY + 1, 21, green)
    rows.forEach((line, index) => text(context, line, 150, informationY + index * 29, 24))
    informationY += rows.length * 29 + 12
  }

  rule(context, 1240)
  text(context, '一起参加这场活动', margin, 1280, 34, green, true)
  text(context, '扫码查看详情并报名', margin, 1336, 25)
  text(context, '由分享者邀请', margin, 1383, 21, muted)
  // No crop or overlay on the actual code; leave its own quiet zone intact.
  context.setFillStyle('#FFFFFF')
  context.fillRect(540, 1258, 178, 178)
  context.drawImage(code.path, 549, 1267, 160, 160)

  await new Promise<void>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => reject(new Error('海报绘制超时，请重试')), 15000)
    try { context.draw(false, () => { globalThis.clearTimeout(timeout); resolve() }) }
    catch (error) { globalThis.clearTimeout(timeout); reject(error) }
  })
  return new Promise<string>((resolve, reject) => {
    uni.canvasToTempFilePath({ canvasId, x: 0, y: 0, width: POSTER_WIDTH, height: POSTER_HEIGHT,
      destWidth: POSTER_WIDTH * 2, destHeight: POSTER_HEIGHT * 2, fileType: 'png',
      success: result => result.tempFilePath ? resolve(result.tempFilePath) : reject(new Error('海报导出失败，请重试')),
      fail: () => reject(new Error('海报导出失败，请重试')),
    }, component)
  })
}
