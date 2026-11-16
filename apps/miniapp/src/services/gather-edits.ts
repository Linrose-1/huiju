import type { AiActivityDraft } from './api/types'
import { applyGatherAnswer, needsGatherEnd, withJoiningDetails } from './gather-dialog'
import type { GatherDraft, GatherField } from './gather-dialog'

const labels = {
  title: /^(?:聚会|活动)?(?:标题|主题|名称|名字)|^改名/,
  description: /^(?:聚会|活动)?(?:介绍|简介|描述|文案)/,
  location: /^(?:聚会|活动)?(?:地点|地址|场地)|^(?:改在|定在|安排在|放在)/,
  contact: /^(?:咨询方式|联系方式|联系电话|联系人|手机号|微信号)/
}
const keep = /(?:不变|照旧|不改|保持原样|维持原样)/
const editMarker = /((?:(?:聚会|活动)?(?:标题|主题|名称|介绍|简介|描述|地点|场地|地址)|联系方式|咨询方式|报名截止时间|结束时间|开始时间|人数|名额|费用)(?:\s*[:：]|\s*(?:改|换|调|定|设|保持|不变|不改|照旧))|其他(?:照旧|不变))/g
const clock = /(?:凌晨|上午|中午|下午|晚上|早上)?\s*([零一二两三四五六七八九十\d]{1,3})(?:[点时](?!间|长)(半|[零一二三四五六七八九十\d]+分?)?|[:：](\d{2}))/g
const clockDigits = '零一二三四五六七八九'
function clockNumber(text: string) {
  if (/^\d+$/.test(text)) return Number(text)
  const [hi, lo] = text.replace('两', '二').split('十')
  if (lo === undefined) return clockDigits.indexOf(hi)
  return (hi ? clockDigits.indexOf(hi) : 1) * 10 + (lo ? clockDigits.indexOf(lo) : 0)
}
function localDay(iso: string) {
  return new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10)
}
function applyTime(d: GatherDraft, clause: string, parsed: GatherDraft, answeringTime: boolean, model?: AiActivityDraft) {
  const previousDay = d.date
  const endOnly = /结束|散场/.test(clause) || (answeringTime && needsGatherEnd(d) && !/开始|开场|开办/.test(clause))
  Object.assign(d, { date:parsed.date, period:endOnly ? d.period : parsed.period, startsAt:parsed.startsAt, endsAt:parsed.endsAt })
  const clocks = [...clause.matchAll(clock)]
  if (clocks.length > 1 || /(?:持续|时长|历时)/.test(clause)) {
    if (model?.startsAt && model.endsAt && (!d.date || localDay(model.startsAt) === d.date) && /(?:持续|时长|历时)/.test(clause)) {
      d.startsAt = model.startsAt; d.endsAt = model.endsAt; d.date = localDay(model.startsAt)
    }
  } else if (clocks.length === 1) {
    const m = clocks[0]
    const old = endOnly ? d.endsAt : d.startsAt
    const date = endOnly && /次日|翌日/.test(clause) && d.startsAt
      ? localDay(new Date(Date.parse(d.startsAt) + 86400000).toISOString())
      : endOnly && old && previousDay === d.date ? localDay(old) : d.date
    const startHour = d.startsAt ? new Date(Date.parse(d.startsAt) + 8 * 3600000).getUTCHours() : 0
    const period = m[0].match(/凌晨|上午|中午|下午|晚上|早上/)?.[0] || (m[3] ? '' : d.period || (endOnly && startHour >= 12 ? '下午' : ''))
    let hour = clockNumber(m[1])
    if (hour < 12 && /下午|晚上|中午/.test(period)) hour += 12
    const minute = m[3] ? Number(m[3]) : m[2] === '半' ? 30 : m[2] ? clockNumber(m[2].replace('分','')) : 0
    if (date && hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      const iso = date + 'T' + String(hour).padStart(2,'0') + ':' + String(minute).padStart(2,'0') + ':00+08:00'
      if (!endOnly || !d.startsAt || Date.parse(iso) > Date.parse(d.startsAt)) d[endOnly ? 'endsAt' : 'startsAt'] = iso
    }
  }
}

export function applyGatherEdit(before: GatherDraft, text: string, currentField: GatherField | null, source: 'card' | 'chat', model?: AiActivityDraft): GatherDraft {
  const d = {...before}
  const clauses = source === 'card' ? [text.trim()] : text.replace(editMarker, '，$1').split(/[，,。；;\n]/).map(s => s.trim()).filter(Boolean)
  for (const clause of clauses) {
    if (!clause || keep.test(clause)) continue
    const allowed = (field: GatherField) => source === 'chat' || currentField === field
    const parsed = applyGatherAnswer(d, 'time', clause)
    let matched = false
    for (const [field, label] of Object.entries(labels) as [keyof typeof labels,RegExp][]) {
      if (!allowed(field) || !label.test(clause)) continue
      const value = clause.replace(label,'').replace(/^\s*(?:改为|改成|改到|改在|换成|设为|定为|定在|写成|调整为|调整到|是|叫|为|在|用)?\s*[:：]?\s*/, '').trim()
      if (value) {
        const key = field === 'contact' ? 'consultationContact' : field
        d[key] = value
      }
      matched = true
    }
    // A place or title can contain numbers or calendar words as part of its name.
    if (matched) continue
    if (allowed('location') && withJoiningDetails(d.location, clause) !== d.location) {
      d.location = withJoiningDetails(d.location, clause)
      continue
    }
    // The model may offer a duration instead of a clock when only the end is missing.
    if (allowed('time') && needsGatherEnd(d)) {
      const duration = clause.match(/^(?:大约|大概|约|聊|持续|预计|开)?\s*(半|\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*(?:个)?(小时|分钟)(?:左右|吧|后结束)?$/)
      if (duration) {
        const amount = duration[1] === '半' ? 0.5 : /^\d/.test(duration[1]) ? Number(duration[1]) : clockNumber(duration[1])
        const minutes = amount * (duration[2] === '小时' ? 60 : 1)
        const end = new Date(Date.parse(d.startsAt!) + minutes * 60000)
        if (minutes > 0 && Number.isFinite(+end)) d.endsAt = end.toISOString()
        continue
      }
    }
    if (/报名截止|截止报名/.test(clause)) {
      if (source === 'chat' && model?.registrationDeadline) d.registrationDeadline = model.registrationDeadline
      continue
    }
    if ((allowed('capacity') && /人数|名额|限额|限收|上限|[\d一二两三四五六七八九十]\s*(?:位|人|名)(?!均)/.test(clause))
      || (currentField === 'capacity' && /^\d+$/.test(clause))) {
      const amount = clause.match(/(?:人数|名额|限额|限收|上限)\s*(?:改为|改成|调整为|设为|为)?\s*(\d+)(?![\d.])/)
      const limited = applyGatherAnswer(d, 'capacity', clause.replace(/(\d)\s*名/g, '$1人'))
      if (/不限/.test(clause)) d.capacity = null
      else if (amount && Number(amount[1]) > 0) d.capacity = Number(amount[1])
      else d.capacity = limited.capacity
      matched = true
    }
    if ((allowed('fee') || allowed('amount')) && (/免费|收费|费用|[¥￥]|元|块钱/.test(clause) || currentField === 'amount' && /^\d+(?:\.\d+)?$/.test(clause))) {
      const money = clause.match(/(\d+(?:\.\d{1,2})?|[零一二两三四五六七八九十百千]+)\s*(?:元|块)/)
      const simpleAmount = money && !/[百千]/.test(money[1])
        ? (/^[\d.]+$/.test(money[1]) ? Number(money[1]) : clockNumber(money[1])) : null
      const fee = applyGatherAnswer(d, 'amount', simpleAmount !== null && simpleAmount >= 0 ? String(simpleAmount) : clause)
      if (money && simpleAmount === null && model?.feeAmountCents != null) {
        d.feeType = model.feeAmountCents === 0 ? 'free' : 'paid'
        d.feeAmountCents = model.feeAmountCents || null
      } else {
        d.feeType = fee.feeType
        d.feeAmountCents = fee.feeType === 'paid' ? (fee.feeAmountCents ?? d.feeAmountCents) : null
      }
      matched = true
    }
    if ((allowed('date') || allowed('time')) && (parsed.date !== d.date || /今天|明天|后天|[周星期礼拜][一二三四五六日天]|\d月|\d[-/]\d|上午|下午|晚上|结束|开始|\d[:：]\d|[\d一二两三四五六七八九十]点/.test(clause))) {
      if (source === 'card' && currentField === 'date') {
        const dateOnly = applyGatherAnswer(d, 'date', clause.replace(clock,'').replace(/凌晨|上午|中午|下午|晚上|早上/g,''))
        Object.assign(d, {date:dateOnly.date, startsAt:dateOnly.startsAt, endsAt:dateOnly.endsAt})
      } else applyTime(d, clause, parsed, currentField === 'time', model)
      matched = true
    }
    // One spoken clause may give both a time and a venue.
    const venue = model?.location || clause.match(/在(.{1,100}?)(?:举办|举行|集合|见面|碰面|办聚会)$/)?.[1]
    if (source === 'chat' && venue && clause.includes(venue) && (!matched && currentField === 'location' || /在|地点|场地|地址/.test(clause))) {
      d.location = venue
      continue
    }
    if (matched) continue
    const directVenue = /线上聚会|路|街|巷|村|区|馆|园|楼|厅|室|店|校|院|中心|创客|广场|大厦|空间|餐吧/.test(clause)
    if (currentField && ['title','description','location','contact','joining'].includes(currentField)
        && (source === 'card' || (clauses.length === 1 && (currentField !== 'location' || directVenue)
          && !/^(?:改|修改|取消|调整|增加|换|不要)|\?$|？$/.test(clause)))) {
      const field = currentField === 'joining' ? 'location' : currentField
      Object.assign(d, {[field === 'contact' ? 'consultationContact' : field]:clause})
    }
  }
  return d
}
