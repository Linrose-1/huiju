import { fail } from '../flow/common.js'
import type { ActivityDraftDto, DraftQuestionDto } from './dto.js'

type JsonObject = Record<string, unknown>
const object = (value: unknown): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null
const date = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10))
  const dayCheck = new Date(Date.UTC(year, month - 1, day))
  if (dayCheck.getUTCFullYear() !== year || dayCheck.getUTCMonth() !== month - 1 || dayCheck.getUTCDate() !== day) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}
const positiveInt = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 4294967295 ? value : null

function pendingFacts(idea: string) {
  // A bounded guard for explicit undecided fields, not a general fact extractor.
  const field = '报名截止(?:时间|日期)?|开始时间|结束时间|活动时间|活动日期|时间|日期|人数上限|人数|名额|免费(?:还是|或|/)收费|收费(?:还是|或|/)免费|是否收费|收费模式|费用|金额|价格'
  const undecided = '(?:待定|待确认|待确定|未定|未确定|未确认|不确定|没确定|没有确定)'
  const list = `(?:${field})(?:[\\s、和及与]+(?:${field}))*`
  const phrases = new RegExp(`${list}(?:[\\s：:]|都|均|还|尚|暂|仍|是|为)*${undecided}|${undecided}\\s*${list}`, 'g')
  const fields = [...idea.matchAll(phrases)].flatMap(match => match[0].match(new RegExp(field, 'g')) ?? [])
  const has = (pattern: RegExp) => fields.some(value => pattern.test(value))
  return {
    time: has(/^(?:活动)?(?:时间|日期)$/), start: has(/^开始/), end: has(/^结束/), deadline: has(/^报名截止/),
    capacity: has(/人数|名额/), feeMode: has(/收费/), fee: has(/^费用$/), amount: has(/金额|价格/),
  }
}

function explicitChineseTimes(idea: string) {
  const dates = [...idea.matchAll(/((?:19|20)\d{2})年(\d{1,2})月(\d{1,2})日/g)]
  const eventTimes: string[] = []
  let registrationDeadline: string | null = null
  for (let i = 0; i < dates.length; i++) {
    const match = dates[i]
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
    const validDay = new Date(Date.UTC(year, month - 1, day))
    if (validDay.getUTCFullYear() !== year || validDay.getUTCMonth() !== month - 1 || validDay.getUTCDate() !== day) continue
    const after = idea.slice(match.index! + match[0].length, dates[i + 1]?.index ?? idea.length)
    const before = idea.slice(Math.max(0, match.index! - 8), match.index)
    const deadline = /报名截止(?:是|在|于)?$/.test(before) || /^.{0,12}截止/.test(after)
    const times = [...after.matchAll(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})(?:点|时)(半|(\d{1,2})分?)?/g)]
    for (const time of times) {
      const period = time[1], rawHour = Number(time[2])
      let hour = rawHour
      if (['下午', '傍晚', '晚上'].includes(period) && rawHour >= 1 && rawHour <= 11) hour += 12
      if (['凌晨', '早上', '上午'].includes(period) && rawHour === 12) hour = 0
      const minute = time[3] === '半' ? 30 : Number(time[4] || 0)
      if (hour > 23 || minute > 59 || (!period && rawHour <= 12 && rawHour !== 0)) continue
      const value = new Date(Date.UTC(year, month - 1, day, hour, minute) - 8 * 60 * 60 * 1000).toISOString()
      if (deadline) { registrationDeadline ??= value; break }
      eventTimes.push(value)
      if (eventTimes.length >= 2) break
    }
  }
  return { startsAt: eventTimes[0] ?? null, endsAt: eventTimes[1] ?? null, registrationDeadline }
}

export function parseActivityDraft(value: unknown, idea: string): ActivityDraftDto {
  if (!object(value)) fail('AI_GENERATION_FAILED', '生成失败，请手动重试', 502)
  const questionRows = Array.isArray(value.questions) ? value.questions.slice(0, 20) : []
  const questions: DraftQuestionDto[] = questionRows.flatMap((row): DraftQuestionDto[] => {
    if (!object(row)) return []
    const prompt = string(row.prompt, 1000)
    if (!prompt) return []
    const type = ['short_text', 'long_text', 'single', 'multiple'].includes(String(row.type)) ? row.type as DraftQuestionDto['type'] : null
    const options = Array.isArray(row.options) && row.options.length > 0 && row.options.length <= 100
      && row.options.every(v => typeof v === 'string' && Boolean(v.trim()) && v.length <= 200)
      ? [...new Set((row.options as string[]).map(v => v.trim()))] : null
    return [{ prompt, type, required: typeof row.required === 'boolean' ? row.required : null,
      options: type === 'single' || type === 'multiple' ? options : null }]
  })
  // A year alone cannot authorize model-invented month/day values.
  const dated = /(?:19|20)\d{2}(?:年\d{1,2}月\d{1,2}日|([-/.])\d{1,2}\1\d{1,2}(?!\d))/.test(idea)
  const pending = pendingFacts(idea)
  const explicit = dated ? explicitChineseTimes(idea) : null
  const startsAt = dated && !pending.time && !pending.start ? date(value.startsAt) ?? explicit?.startsAt ?? null : null
  let endsAt = dated && !pending.time && !pending.end ? date(value.endsAt) ?? explicit?.endsAt ?? null : null
  let registrationDeadline = dated && !pending.deadline && (!pending.time || explicit?.registrationDeadline)
    ? date(value.registrationDeadline) ?? explicit?.registrationDeadline ?? null : null
  if (startsAt && endsAt && endsAt <= startsAt) endsAt = null
  if (startsAt && registrationDeadline && registrationDeadline > startsAt) registrationDeadline = null
  const explicitlyPaid = /(?:^|[，,。；;])\s*(?:确定|需要|活动)?收费(?:活动)?\s*(?=[，,。；;]|$)/.test(idea)
  const feeType = pending.feeMode ? null : pending.fee ? (explicitlyPaid ? 'paid' : null)
    : value.feeType === 'free' || value.feeType === 'paid' ? value.feeType : null
  return {
    title: string(value.title, 50), description: string(value.description, 1000),
    startsAt, endsAt, location: string(value.location, 500), capacity: pending.capacity ? null : positiveInt(value.capacity),
    feeType, feeAmountCents: feeType === 'paid' && !pending.fee && !pending.amount ? positiveInt(value.feeAmountCents) : null,
    registrationDeadline, questions,
  }
}

export function missingFields(draft: ActivityDraftDto) {
  const fields = ['title', 'description', 'startsAt', 'endsAt', 'location', 'capacity', 'feeType', 'registrationDeadline'] as const
  const missing = fields.filter(field => draft[field] === null)
  if (draft.feeType === 'paid' && draft.feeAmountCents === null) missing.push('feeAmountCents' as typeof fields[number])
  return [...missing, 'coverUrl', 'consultationContact']
}
