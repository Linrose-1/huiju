import type { AiActivityDraft } from './api/types'

export type GatherField = 'title' | 'description' | 'date' | 'time' | 'location' | 'fee' | 'amount' | 'contact' | 'capacity' | 'joining'
export type GatherDraft = AiActivityDraft & { consultationContact: string; date: string; period: string }
export type GatherQuestion = { field: GatherField; prompt: string; options: string[] }
const day = 86400000
const digits = '零一二三四五六七八九'
function number(value: string): number {
  if (/^\d+$/.test(value)) return Number(value)
  if (value === '两') return 2
  const [tens, units] = value.split('十')
  if (units !== undefined) return (tens ? digits.indexOf(tens) : 1) * 10 + (units ? digits.indexOf(units) : 0)
  return digits.indexOf(value)
}
function chinaDate(time: number) { return new Date(time + 8 * 3600000).toISOString().slice(0, 10) }
function parseDay(text: string, now: Date) {
  const today = chinaDate(+now)
  const literal = text.match(/(?:(\d{4})[年/-])?(\d{1,2})[月/-](\d{1,2})(?:[日号])?/)
  if (literal) {
    const result = [literal[1] || today.slice(0, 4), ...literal.slice(2).map(n => n.padStart(2, '0'))].join('-')
    const stamp = Date.parse(result + 'T00:00:00+08:00')
    return Number.isFinite(stamp) && chinaDate(stamp) === result ? result : ''
  }
  const weekdays = text.match(/(下下|下|本|这)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天])/)
  let offset = 0
  if (weekdays) {
    const weekday = (new Date(today).getUTCDay() + 6) % 7
    offset = '一二三四五六日'.indexOf(weekdays[2].replace('天', '日')) - weekday
    if (weekdays[1] === '下下') offset += 14
    else if (weekdays[1] === '下' || (!weekdays[1] && offset < 0)) offset += 7
  } else if (/大后天/.test(text)) offset = 3
  else if (/后天/.test(text)) offset = 2
  else if (/明天/.test(text)) offset = 1
  else if (!/今天/.test(text)) return ''
  return chinaDate(+now + offset * day)
}
function parseRange(text: string, period: string) {
  const pattern = /(?:(凌晨|上午|中午|下午|晚上|早上))?\s*([零一二两三四五六七八九十\d]{1,3})(?:[点时](半|[零一二三四五六七八九十\d]+分?)?|[:：](\d{2}))/g
  const parts = [...text.matchAll(pattern)]
  if (parts.length !== 2 || !/^[\s至到–—~～-]+$/.test(text.slice(parts[0].index! + parts[0][0].length, parts[1].index))) return null
  let hint = period
  const times = parts.map(m => {
    hint = m[1] || hint
    let h = number(m[2])
    const min = m[4] ? Number(m[4]) : m[3] === '半' ? 30 : m[3] ? number(m[3].replace('分','')) : 0
    if (h < 12 && /下午|晚上|中午/.test(hint)) h += 12
    return h < 0 || h > 23 || min < 0 || min > 59 ? '' : String(h).padStart(2,'0') + ':' + String(min).padStart(2,'0')
  })
  return times[0] && times[1] > times[0] ? times : null
}
export function createGatherDraft(idea: string, draft: AiActivityDraft, now = new Date()): GatherDraft {
  const date = draft.startsAt ? chinaDate(Date.parse(draft.startsAt)) : parseDay(idea, now)
  const result = { ...draft, date, period: idea.match(/上午|下午|晚上|早上|中午/)?.[0] || '', consultationContact: '' }
  const range = parseRange(idea, result.period)
  if (range && date && !result.startsAt && !result.endsAt) setRange(result, range)
  return result
}
function setRange(d: GatherDraft, times: string[]) {
  d.startsAt = d.date + 'T' + times[0] + ':00+08:00'
  d.endsAt = d.date + 'T' + times[1] + ':00+08:00'
}
// A bare online venue still needs instructions for guests. Store the confirmed
// arrangement in the existing location so the invitation and editor agree.
function needsJoining(location: string | null) {
  return !!location && /^(?:线上|在线|网络|远程|腾讯会议|飞书会议|钉钉会议|zoom)(?:聚会|活动|交流|举行|举办|会议)?$/i.test(location.trim())
}
export function pendingGatherFields(d: GatherDraft, now = new Date()): GatherField[] {
  const fields: GatherField[] = []
  if (!d.title?.trim()) fields.push('title')
  if (!d.description?.trim()) fields.push('description')
  if (!d.date || d.date < chinaDate(+now)) fields.push('date')
  else if (!d.startsAt || !d.endsAt || Date.parse(d.startsAt) <= +now || Date.parse(d.endsAt) <= Date.parse(d.startsAt)) fields.push('time')
  if (!d.location?.trim()) fields.push('location')
  else if (needsJoining(d.location)) fields.push('joining')
  if (!d.feeType) fields.push('fee')
  else if (d.feeType === 'paid' && !d.feeAmountCents) fields.push('amount')
  if (!d.consultationContact.trim()) fields.push('contact')
  return fields
}
export function nextGatherQuestion(d: GatherDraft, now = new Date()): GatherQuestion | null {
  const [field] = pendingGatherFields(d, now)
  return field ? gatherQuestionFor(field, d, now) : null
}
export function usableModelQuestion(q: GatherQuestion | null | undefined, d: GatherDraft): GatherQuestion | null {
  if (!q || !pendingGatherFields(d).includes(q.field) || !q.prompt?.trim() || !Array.isArray(q.options)) return null
  return { field:q.field, prompt:q.prompt.trim(), options:[...new Set(q.options.map(x => x.trim()).filter(x => x && x !== '自己填写'))].slice(0,4) }
}
export type GatherTurn = { field:GatherField; prompt:string; answer:string }
export function publicText(value: string) {
  return value.replace(/(?:https?:\/\/|www\.)[^\s，。；]+/gi, '（链接已省略）')
    .replace(/(?:\+?86[ -]?)?1[3-9](?:[ -]?\d){9}(?!\d)|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:微信号?|QQ|会议号|密码|口令)\s*[:：]?\s*[a-z0-9_.-]+(?:[ -]+[0-9]+)*/gi, '（信息已省略）')
}
export function gatherContext(d: GatherDraft, turns: GatherTurn[]) {
  const facts: Partial<Record<GatherField,string|null>> = {
    title:d.title, description:d.description, date:d.date, time:d.startsAt && d.endsAt ? d.startsAt+' 至 '+d.endsAt : null,
    location:d.location, fee:d.feeType, amount:d.feeAmountCents ? String(d.feeAmountCents/100)+'元' : null,
    capacity:d.capacity ? String(d.capacity)+'人' : null
  }
  return {
    known:Object.entries(facts).flatMap(([field,value]) => value ? [{field:field as GatherField,value:publicText(value).slice(0,500)}] : []),
    pending:pendingGatherFields(d),
    recent:turns.filter(t => t.field !== 'contact').slice(-6).map(t => ({field:t.field, prompt:publicText(t.prompt).slice(0,120),answer:publicText(t.answer).slice(0,500)}))
  }
}
export function applyGatherAnswer(draft: GatherDraft, field: GatherField, answer: string, now = new Date()): GatherDraft {
  const d = {...draft}
  const text = answer.trim()
  if (!text) return d
  if (field==='contact') { d.consultationContact=text; return d }
  if (field==='joining') {
    const arrangement = text.split(/[，,；;](?=\s*(?:免费|收费|限|最多|每人))/)[0].trim()
    if (arrangement) d.location = (d.location?.split(' · ')[0] || '线上聚会') + ' · ' + arrangement
  }
  if (field==='title' || field==='description' || field==='location') { d[field]=text; return d }
  const date = parseDay(text, now)
  if (date && date!==d.date) {
    // A correction to the day alone keeps both confirmed times and any overnight duration.
    const delta = Date.parse(date) - Date.parse(d.date)
    if (Number.isFinite(delta)) {
      if (d.startsAt) d.startsAt = new Date(Date.parse(d.startsAt) + delta).toISOString()
      if (d.endsAt) d.endsAt = new Date(Date.parse(d.endsAt) + delta).toISOString()
    }
    d.date=date
  }
  d.period=text.match(/上午|下午|晚上|早上|中午/)?.[0] || d.period
  const times=parseRange(text,d.period)
  if (times && d.date) setRange(d,times)
  const amount=text.match(/(?:收费|每人|¥|￥)\s*(\d+(?:\.\d{1,2})?)(?:元|块)?|(?:^|[，,\s])(\d+(?:\.\d{1,2})?)\s*(?:元|块)/)
  const money = amount ? Number(amount[1] || amount[2]) : field==='amount' && /^\d+(?:\.\d{1,2})?$/.test(text) ? Number(text) : null
  const negatesFree = /(?:非|并非|不是|不再|不)免费/.test(text)
  if ((!negatesFree && /免费|不收费/.test(text)) || money===0) {d.feeType='free';d.feeAmountCents=null}
  else if (money!==null || negatesFree || /收费/.test(text)) {d.feeType='paid';d.feeAmountCents=money===null ? null : Math.round(money*100)}
  const people=text.match(/(?:最多|限额?|上限|人数|限收)?\s*([\d一二两三四五六七八九十]+)\s*(?:位|人)(?!均)/)
  if (field==='capacity' && /^\d+$/.test(text) && Number(text)>0) d.capacity=Number(text)
  if (people && number(people[1])>0) d.capacity=number(people[1])
  if (/不限人数|人数不限/.test(text)) d.capacity=null
  return d
}
export function gatherQuestionFor(field: GatherField, draft: GatherDraft, now = new Date()): GatherQuestion {
  const prompts: Record<GatherField, string> = {
    title:'聚会的主题叫什么？', description:'想怎么介绍这次聚会？', date:'聚会改到哪天？',
    time:'几点开始和结束？', location:'聚会在哪里举办？', fee:'这场聚会怎么收费？',
    joining:'大家怎么加入这场线上聚会？', amount:'每人收多少元？', contact:'参与者可以怎样联系你？', capacity:'最多多少人可以参加？'
  }
  let options: string[] = []
  if (field === 'title') options = ['商友主题交流会', '创业者经验分享', '学友小聚']
  if (field === 'description') options = draft.title
    ? ['围绕「' + draft.title + '」分享经验，交流想法。', '欢迎对「' + draft.title + '」感兴趣的朋友一起交流。']
    : ['分享近期实践，交流彼此的经验。']
  if (field === 'location') options = ['线上聚会']
  if (field === 'joining') options = ['填写会议链接','报名后发会议链接']
  if (field === 'amount') options = ['每人 30 元', '每人 50 元', '每人 100 元']
  if (field === 'fee') options = ['免费','收费']
  if (field === 'date') options = ['今天','明天','后天']
  if (field === 'capacity') options = ['不限人数','限 10 人','限 20 人']
  if (field === 'time') {
    const slots = /早上|上午/.test(draft.period) ? ['09:00–11:00','10:00–12:00']
      : draft.period === '晚上' ? ['18:00–20:00','19:00–21:00'] : ['14:00–16:00','15:00–17:00','14:00–17:00']
    options = slots.filter(slot => Date.parse(draft.date+'T'+slot.slice(0,5)+':00+08:00') > +now)
    if (!options.length) return {field:'time', prompt:'建议时段已过，要换一天还是另填时段？', options:['改到明天','改到后天']}
    prompts.time = draft.date + ' ' + draft.period + '，几点开始和结束？'
  }
  return {field, prompt:prompts[field], options}
}
