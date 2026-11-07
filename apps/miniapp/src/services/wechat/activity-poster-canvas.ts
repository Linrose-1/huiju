import { activityTimeRange } from '@/services/presentation'

export const POSTER_WIDTH = 750
export const POSTER_HEIGHT = 1450

export interface ActivityPosterData {
  title: string
  organizerName?: string | null
  hostOrganization?: string | null
  organizingOrganization?: string | null
  sponsorOrganization?: string | null
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
const green = '#155B45', ink = '#20372D', muted = '#52665B', margin = 63
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

function stroke(context: Context, color: string, points: [number, number][]) {
  context.setStrokeStyle(color)
  context.setLineWidth(1)
  context.beginPath()
  context.moveTo(...points[0])
  for (const point of points.slice(1)) context.lineTo(...point)
  context.stroke()
}

function rule(context: Context, y: number) {
  stroke(context, '#B1BCB0', [[margin, y], [POSTER_WIDTH - margin, y]])
}

function posterDetails(context: Context, data: ActivityPosterData, compact: boolean) {
  const size = compact ? 21 : 24
  const leading = compact ? 25 : 31
  const rowGap = compact ? 5 : 10
  const sectionGap = compact ? 11 : 24
  font(context, size)
  const highlights = data.highlights.map(value => value.trim()).filter(Boolean).slice(0, 2)
  const highlightLabel = highlights.length ? '本次看点' : '欢迎一起交流'
  const highlightX = highlights.length ? margin + 140 : margin + 184
  const highlightLines = lines(context, highlights.join('　·　') || '查看活动详情，了解更多信息', POSTER_WIDTH - margin - highlightX)
  const highlightHeight = sectionGap * 2 + highlightLines.length * leading
  const amount = data.feeAmount
  const price = data.feeType === 'free' ? '免费参与'
    : typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? `¥${(amount / 100).toFixed(2)} / 人` : '费用请查看活动详情'
  const valueWidth = contentWidth - 140
  const facts = [
    { label: '时间', rows: limitedLines(context, activityTimeRange(data.startsAt, data.endsAt), valueWidth, 2) },
    { label: '地点', rows: limitedLines(context, data.location || '地点请查看活动详情', valueWidth, 2) },
    { label: '费用', rows: [price] },
  ]
  const creditFields: [string, string | null | undefined][] = [
    ['聚会发起人', data.organizerName], ['主办单位', data.hostOrganization],
    ['承办单位', data.organizingOrganization], ['赞助单位', data.sponsorOrganization],
  ]
  const credits = creditFields.flatMap(([label, value]) => {
    if (!value?.trim()) return []
    font(context, size, label === '聚会发起人')
    return [{ label, rows: lines(context, value, valueWidth) }]
  })
  const rowHeight = (item: { rows: string[] }) => item.rows.length * leading + rowGap
  const factHeight = sectionGap * 2 + facts.reduce((sum, item) => sum + rowHeight(item), 0) - rowGap
  const creditHeight = credits.length ? sectionGap * 2 + credits.reduce((sum, item) => sum + rowHeight(item), 0) - rowGap : 0
  const height = highlightHeight + factHeight + creditHeight
  function draw(y: number) {
    text(context, highlightLabel, margin, y + sectionGap, compact ? 23 : 26, green, true)
    highlightLines.forEach((line, index) => text(context, line, highlightX, y + sectionGap + index * leading, size))
    y += highlightHeight
    rule(context, y)
    for (const group of [facts, credits]) {
      if (!group.length) continue
      y += sectionGap
      for (const item of group) {
        const organizer = item.label === '聚会发起人'
        text(context, item.label, margin, y, compact ? 20 : 22, muted)
        item.rows.forEach((line, index) => text(context, line, margin + 140, y + index * leading, size, organizer ? green : ink, organizer))
        y += rowHeight(item)
      }
      y += sectionGap - rowGap
      if (group === facts && credits.length) rule(context, y)
    }
  }
  return { height, draw }
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
  context.setFillStyle('#F8F7F1')
  context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)
  context.setTextBaseline('top')
  context.setTextAlign('left')

  stroke(context, '#80998A', [[18, 18], [732, 18], [732, 1432], [18, 1432], [18, 18]])
  stroke(context, '#977C49', [[24, 56], [24, 24], [56, 24]])
  stroke(context, '#977C49', [[694, 1426], [726, 1426], [726, 1394]])

  if (options.brandVisible !== false) {
    const brand = options.brandName?.trim() || '有聚点'
    let size = 26
    font(context, size, true)
    while (size > 18 && context.measureText(brand).width > 470) font(context, --size, true)
    limitedLines(context, brand, 470, 2).forEach((line, index) => text(context, line, margin, 44 + index * 22, size, green, true))
  }
  text(context, '活动邀请', 594, 48, 22)
  rule(context, 94)

  // Preserve the entire allowed title, shrinking it instead of silently truncating it.
  let titleSize = 49
  font(context, titleSize, true)
  let titleLines = lines(context, data.title, contentWidth)
  while ((titleLines.length > 3 || titleLines.length * titleSize * 1.22 > 132) && titleSize > 24) {
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
  titleLines.forEach((line, index) => text(context, line, margin, 116 + index * titleSize * 1.22, titleSize, ink, true))
  const subtitleTop = 116 + titleLines.length * titleSize * 1.22 + 8
  font(context, 24)
  const subtitleRows = limitedLines(context, data.subtitle, contentWidth, 2)
  subtitleRows.forEach((line, index) => text(context, line, margin, subtitleTop + index * 32, 24, muted))
  const coverTop = subtitleTop + subtitleRows.length * 32 + 24
  const footerTop = 1203
  let details = posterDetails(context, data, false)
  // Make room for long titles and full organization names without touching the code's quiet zone.
  if (footerTop - coverTop - details.height < 350) details = posterDetails(context, data, true)
  const coverHeight = Math.min(448, footerTop - coverTop - details.height)
  const coverWidth = coverHeight * 5 / 4
  const scale = Math.max(coverWidth / cover.width, coverHeight / cover.height)
  const sourceWidth = coverWidth / scale, sourceHeight = coverHeight / scale
  context.drawImage(cover.path, (cover.width - sourceWidth) / 2, (cover.height - sourceHeight) / 2, sourceWidth, sourceHeight,
    (POSTER_WIDTH - coverWidth) / 2, coverTop, coverWidth, coverHeight)
  details.draw(coverTop + coverHeight)

  rule(context, footerTop)
  text(context, '一起参加这场活动', margin, 1256, 31, green, true)
  text(context, '扫码查看详情并报名', margin, 1308, 22)
  text(context, '由分享者邀请', margin, 1350, 19, muted)
  context.setFillStyle('#FFFFFF')
  context.fillRect(509, 1223, 178, 178)
  const codeScale = 160 / Math.max(code.width, code.height)
  const codeWidth = code.width * codeScale, codeHeight = code.height * codeScale
  context.drawImage(code.path, 518 + (160 - codeWidth) / 2, 1232 + (160 - codeHeight) / 2, codeWidth, codeHeight)

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
