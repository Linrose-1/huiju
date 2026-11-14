import type { ActivityDraftDto, DraftConversation, DraftReplyContext, GatherQuestionDto } from './dto.js'

// Do not send contact details typed together with the event idea to the provider.
export function withoutContactDetails(text: string): string {
  return text
    .replace(/(?:咨询联系方式|联系电话|联系方式|联系人|微信号|手机号(?:码)?|电子邮箱)\s*[:：是为]?\s*[^，,。；;\n]+|(?:咨询|微信|手机|电话|QQ|邮箱)\s*[:：是为]\s*[^，,。；;\n]+|(?:加我?微信|微信|QQ)\s*[a-zA-Z0-9][\w.-]{4,}/gi, '（联系方式已省略）')
    .replace(/(?:\+?86[ -]?)?1[3-9](?:[ -]?\d){9}(?!\d)|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '（联系方式已省略）')
}

// Resolve unambiguous weekdays against the Beijing calendar at request time.
export function normalizeDraftDates(text: string, now: Date, reply?: DraftReplyContext) {
  const today = new Date(now.getTime() + 8 * 3600000)
  const mondayIndex = (today.getUTCDay() + 6) % 7
  const dateFormat = (day: string) => day.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1年$2月$3日')
  const normalized = text.replace(/大后天|今天|明天|后天|(?:本|这|下下|下)(?:个)?(?:周|星期|礼拜)([一二三四五六日天])/g, (word, weekday?: string) => {
    const week = word.startsWith('下下') ? 2 : word.startsWith('下') ? 1 : 0
    const offset = weekday ? week * 7 + '一二三四五六日'.indexOf(weekday.replace('天', '日')) - mondayIndex
      : ['今天', '明天', '后天', '大后天'].indexOf(word)
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset)).toISOString().slice(0, 10)
    return dateFormat(day)
  })
  if (reply?.date && /(?:[\d一二两三四五六七八九十]+[点时]|\d[:：]\d)/.test(text) && !/(?:19|20)\d{2}(?:年|[-/.])|\d月|周|星期|礼拜|月底|月初|今天|明天|后天/.test(text)) {
    return dateFormat(reply.date) + ' ' + normalized
  }
  return normalized
}

export function safeConversationText(value: string) {
  return withoutContactDetails(value).replace(/(?:会议号|入会密码|会议密码|入会口令)\s*[:：]?\s*[\w -]+/gi, '（会议凭据已省略）').replace(/(?:https?:\/\/|www\.)[^\s，。；]+/gi, '（链接已省略）')
}

export function prepareConversation(context: DraftConversation): DraftConversation {
  return {
    known: context.known.filter(row => row.field !== 'contact').map(row => ({ field: row.field, value: safeConversationText(row.value) })),
    recent: context.recent.filter(row => row.field !== 'contact').map(row => ({
      field: row.field, prompt: safeConversationText(row.prompt), answer: safeConversationText(row.answer),
    })),
    pending: context.pending.filter(field => field !== 'joining' && field !== 'capacity'),
  }
}

export function parseNextQuestion(raw: unknown, context: DraftConversation, draft: ActivityDraftDto, idea: string): GatherQuestionDto | null {
  if (!raw || typeof raw !== 'object' || !('nextQuestion' in raw)) return null
  const candidate = raw.nextQuestion
  if (!candidate || typeof candidate !== 'object' || !('field' in candidate) || !('prompt' in candidate) || !('options' in candidate)) return null
  const field = context.pending.find(item => item === candidate.field)
  if (!field) return null
  const known = new Map(context.known.map(row => [row.field, row.value]))
  const location = draft.location || known.get('location') || ''
  const complete: Partial<Record<typeof field, unknown>> = {
    title: draft.title, description: draft.description, date: draft.startsAt || /\d{4}年\d{1,2}月\d{1,2}日/.test(idea),
    time: draft.startsAt && draft.endsAt, location, fee: draft.feeType,
    amount: draft.feeType === 'free' || draft.feeAmountCents,
  }
  if (field === 'amount' && !(draft.feeType === 'paid' || (!draft.feeType && (known.get('fee')?.match(/收费|paid/) || /收费|每人.{0,5}元/.test(idea))))) return null
  if (complete[field] || known.has(field)) return null
  const clean = (value: unknown, max: number) => {
    if (typeof value !== 'string') return null
    const text = value.trim()
    return text && text.length <= max && !/(?:https?:\/\/|www\.|\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:微信号|会议号|会议密码)\s*[:：]?\s*[a-zA-Z0-9_-]{4,})/i.test(text) && !/[<>]/.test(text) && ![...text].some(char => char.charCodeAt(0) < 32) ? text : null
  }
  const prompt = clean(candidate.prompt, 100)
  if (!prompt || !Array.isArray(candidate.options) || candidate.options.length > 4) return null
  const options = [...new Set(candidate.options.map(value => clean(value, 40)).filter((text): text is string =>
    !!text && !['自己填写', '自行填写', '自定义', '其他', '其它'].includes(text)))]
  return { field, prompt, options: field === 'contact' ? [] : options }
}
