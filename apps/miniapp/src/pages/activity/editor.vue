<script setup lang="ts">
import { computed, reactive, ref, watch, nextTick } from 'vue'
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import { api, ApiError, errorMessage } from '@/services/api'
import type { ActivityWriteInput, ManagedActivity } from '@/services/api/types'
import { loginPage, navigate, requireProfile, routes } from '@/services/navigation'
import { mediaUrl } from '@/services/api/environment'
import { feeDisclaimer, activityTimeRangeWeekday } from '@/services/presentation'
import { useSessionStore } from '@/stores/session'
import { chooseCover } from '@/services/wechat'
import { takeActivityDraft } from '@/services/ai-draft'
import type { AiActivityDraft } from '@/services/api/types'
import RequestState from '@/components/base/RequestState.vue'

type QuestionType = 'short_text' | 'long_text' | 'single' | 'multiple'
type DraftQuestion = { key: number; id?: string; prompt: string; type: QuestionType; required: boolean; options: string }
const questionTypes: QuestionType[] = ['short_text', 'long_text', 'single', 'multiple']
const questionLabels = ['简答', '长文本', '单选', '多选']
const id = ref(''), loading = ref(true), busy = ref(false), error = ref(''), submitError = ref('')
const aiDraftApplied = ref(false)
const aiDraftMissing = ref(false)
let fromAi = false
const source = ref<ManagedActivity | null>(null)
const coverUrl = ref(''), coverError = ref(''), uploadingCover = ref(false)
const form = reactive({ title: '', description: '', location: '', consultationContact: '', startDate: '', startTime: '', endDate: '', endTime: '', deadlineDate: '', deadlineTime: '', capacity: '', feeType: 'free', amount: '' })
const customDeadline = ref(false), questions = ref<DraftQuestion[]>([])
let sequence = 0, initialized = false, formOwner = ''
let generation = 0, disposed = false
const session = useSessionStore()
const started = computed(() => source.value?.lifecycle === 'published' && Date.parse(source.value.startsAt) <= Date.now())
const locked = computed(() => !!source.value?.hasRegistrationEver || started.value)
const editable = computed(() => !source.value || (source.value.lifecycle !== 'cancelled' && source.value.moderation === 'normal' && (source.value.lifecycle === 'draft' || Date.parse(source.value.endsAt) > Date.now())))
const step = ref(0)
const reviewed = ref(false)
const previewTime = computed(() => {
  const start = timestamp(form.startDate, form.startTime), end = timestamp(form.endDate, form.endTime)
  return start && end ? activityTimeRangeWeekday(start, end) : '请补充活动时间'
})
const previewQuestionTypes = computed(() => [...new Set(questions.value.map(q => questionLabels[questionTypes.indexOf(q.type)]))].join('、'))
watch([form, questions, coverUrl], () => { reviewed.value = false }, { deep: true, flush: 'sync' })
const capacityLimited = ref(false)
const editingQuestion = ref<DraftQuestion | null>(null)
const questionError = ref('')
const dragIndex = ref(-1), dragOffset = ref(0)
let dragStartY = 0, dragRowHeight = 1, suppressSortMenu = false
watch(() => form.capacity, value => { if (value || step.value === 0) capacityLimited.value = !!value }, { flush: 'sync' })
const locationFocus = ref(false)
const dateField = ref<'start' | 'end' | 'deadline' | null>(null)
const pickerDate = ref(''), pickerTime = ref('')
const target = computed(() => routes.editor + (id.value ? '?id=' + encodeURIComponent(id.value) : fromAi ? '?aiDraft=1' : ''))

function dateParts(value: string) {
  const date = new Date(Date.parse(value) + 8 * 60 * 60 * 1000), pad = (n: number) => String(n).padStart(2, '0')
  return { date: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`, time: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` }
}
function reset() {
  coverUrl.value = ''
  coverError.value = ''
  uploadingCover.value = false
  step.value = 0
  reviewed.value = false
  dateField.value = null
  editingQuestion.value = null
  dragIndex.value = -1
  dragOffset.value = 0
  capacityLimited.value = false
  Object.assign(form, { title: '', description: '', location: '', consultationContact: '', startDate: '', startTime: '', endDate: '', endTime: '', deadlineDate: '', deadlineTime: '', capacity: '', feeType: 'free', amount: '' })
  questions.value = []
  customDeadline.value = false
  source.value = null
  initialized = false
  aiDraftApplied.value = false
  aiDraftMissing.value = false
}
function applyAiDraft(draft: AiActivityDraft) {
  const start = draft.startsAt ? dateParts(draft.startsAt) : { date: '', time: '' }
  const end = draft.endsAt ? dateParts(draft.endsAt) : { date: '', time: '' }
  const deadline = draft.registrationDeadline ? dateParts(draft.registrationDeadline) : { date: '', time: '' }
  Object.assign(form, {
    title: draft.title || '', description: draft.description || '', location: draft.location || '',
    startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time,
    deadlineDate: deadline.date, deadlineTime: deadline.time,
    capacity: draft.capacity ? String(draft.capacity) : '', feeType: draft.feeType || '',
    amount: draft.feeAmountCents ? (draft.feeAmountCents / 100).toFixed(2) : ''
  })
  capacityLimited.value = draft.capacity !== null
  customDeadline.value = draft.registrationDeadline !== null
  questions.value = draft.questions.map(question => ({
    key: ++sequence, prompt: question.prompt, type: question.type || 'short_text',
    required: question.required ?? false, options: (question.options || []).join('\n')
  }))
  aiDraftApplied.value = true
}
async function load() {
  if (busy.value || disposed) return
  const request = ++generation
  loading.value = true
  error.value = ''
  try {
    const ready = await requireProfile(target.value)
    if (request !== generation || disposed) return
    if (!ready) { error.value = '请登录并完善资料后继续'; return }
    const token = session.token, epoch = session.epoch
    const owner = useSessionStore().member?.id || ''
    if (formOwner && formOwner !== owner) reset()
    formOwner = owner
    if (id.value) {
      const activity = await api.managedActivity(id.value)
      if (request !== generation || disposed || token !== session.token || epoch !== session.epoch) return
      source.value = activity
      if (!initialized) {
        coverUrl.value = activity.coverUrl || ''
        const start = dateParts(activity.startsAt), end = dateParts(activity.endsAt), deadline = dateParts(activity.registrationDeadline)
        Object.assign(form, { title: activity.title, description: activity.description, location: activity.location, consultationContact: activity.consultationContact, startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time, deadlineDate: deadline.date, deadlineTime: deadline.time, capacity: activity.capacity ? String(activity.capacity) : '', feeType: activity.feeType, amount: activity.feeAmountCents ? (activity.feeAmountCents / 100).toFixed(2) : '' })
        customDeadline.value = activity.registrationDeadline !== activity.startsAt
      }
      // 首个报名后，以服务端已锁定的问题和金额为准，防止保留的草稿覆盖它们。
      if (!initialized || activity.hasRegistrationEver) {
        questions.value = activity.questions.map(question => ({ key: ++sequence, id: question.id, prompt: question.prompt, type: question.type as QuestionType, required: question.required, options: (question.options || []).join('\n') }))
        form.feeType = activity.feeType
        form.amount = activity.feeAmountCents ? (activity.feeAmountCents / 100).toFixed(2) : ''
      }
    }
    if (!id.value && !initialized && fromAi) {
      const draft = takeActivityDraft(owner, epoch)
      if (draft) applyAiDraft(draft)
      else aiDraftMissing.value = true
    }
    initialized = true
  } catch (e) { if (request === generation && !disposed) error.value = errorMessage(e) }
  finally { if (request === generation && !disposed) loading.value = false }
}
function timestamp(date: string, time: string, original?: string): string | null {
  if (original) {
    const previous = dateParts(original)
    if (previous.date === date && previous.time === time) return original
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const [year, month, day] = date.split('-').map(Number), [hour, minute] = time.split(':').map(Number)
  const result = new Date(Date.UTC(year, month - 1, day, hour, minute) - 8 * 60 * 60 * 1000)
  if (!Number.isFinite(result.getTime())) return null
  const parsed = dateParts(result.toISOString())
  return parsed.date === date && parsed.time === time ? result.toISOString() : null
}
function payload(): ActivityWriteInput {
  if (source.value?.lifecycle === 'published' && Date.parse(source.value.startsAt) <= Date.now()) {
    if (!form.consultationContact.trim()) throw new Error('请填写咨询联系方式')
    const activity = source.value
    return { title: activity.title, description: activity.description, coverUrl: activity.coverUrl, location: activity.location, consultationContact: form.consultationContact.trim(), startsAt: activity.startsAt, endsAt: activity.endsAt, registrationDeadline: activity.registrationDeadline, capacity: activity.capacity, feeType: activity.feeType as 'free' | 'paid', feeAmountCents: activity.feeAmountCents, questions: activity.questions.map(question => ({ ...question, type: question.type as QuestionType })) }
  }
  if (!form.title.trim() || !form.description.trim() || !form.location.trim() || !form.consultationContact.trim()) throw new Error('请填写活动标题、介绍、地点和咨询联系方式')
  if (!form.feeType) throw new Error('请选择免费活动或收费活动')
  const startsAt = timestamp(form.startDate, form.startTime, source.value?.startsAt), endsAt = timestamp(form.endDate, form.endTime, source.value?.endsAt)
  if (!startsAt || !endsAt) throw new Error('请选择完整的开始与结束日期、时间')
  if (!id.value && Date.parse(startsAt) <= Date.now()) throw new Error('活动开始时间应晚于当前时间')
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('结束时间应晚于开始时间')
  const registrationDeadline = customDeadline.value ? timestamp(form.deadlineDate, form.deadlineTime, source.value?.registrationDeadline) : null
  if (customDeadline.value && !registrationDeadline) throw new Error('请选择完整的报名截止日期、时间')
  if (registrationDeadline && Date.parse(registrationDeadline) > Date.parse(startsAt)) throw new Error('报名截止时间不能晚于活动开始时间')
  if (registrationDeadline && !id.value && Date.parse(registrationDeadline) <= Date.now()) throw new Error('报名截止时间应晚于当前时间')
  if (capacityLimited.value && !form.capacity.trim()) throw new Error('请填写人数上限，或选择不限制人数')
  const capacity = form.capacity.trim() ? Number(form.capacity) : null
  if (capacity !== null && (!/^\d+$/.test(form.capacity.trim()) || !Number.isInteger(capacity) || capacity < 1 || capacity > 4294967295)) throw new Error('人数上限请填写有效的正整数，或留空表示不限')
  const amount = form.amount.trim(), feeAmountCents = form.feeType === 'paid' ? Math.round(Number(amount) * 100) : null
  if (form.feeType === 'paid' && (!/^\d+(\.\d{1,2})?$/.test(amount) || !feeAmountCents || feeAmountCents > 4294967295)) throw new Error('收费金额须大于 0，最多保留两位小数')
  const items = questions.value.map((question, index) => {
    const prompt = question.prompt.trim()
    if (!prompt) throw new Error(`请填写第 ${index + 1} 题的题目`)
    const options = question.type === 'single' || question.type === 'multiple' ? question.options.split('\n').map(item => item.trim()).filter(Boolean) : null
    if (options && (options.length < 1 || options.length > 100 || options.some(option => option.length > 200) || new Set(options).size !== options.length)) throw new Error(`第 ${index + 1} 题需填写 1–100 个不同选项，每行一个，每项不超过 200 字`)
    return { ...(question.id ? { id: question.id } : {}), type: question.type, prompt, required: question.required, options }
  })
  return { title: form.title.trim(), description: form.description.trim(), location: form.location.trim(), consultationContact: form.consultationContact.trim(), startsAt, endsAt, registrationDeadline, capacity, feeType: form.feeType as 'free' | 'paid', feeAmountCents, questions: items, coverUrl: coverUrl.value || null }
}
async function changeCover() {
  if (busy.value || loading.value || error.value || started.value || !editable.value || disposed) return
  const request = ++generation, token = session.token, epoch = session.epoch
  const current = () => request === generation && !disposed && token === session.token && epoch === session.epoch
  busy.value = true
  uploadingCover.value = true
  coverError.value = ''
  try {
    const image = await chooseCover()
    if (!image || !current()) return
    const result = await api.uploadCover(image.base64, image.mimeType)
    if (current()) coverUrl.value = result.coverUrl
  } catch (e) {
    if (current()) {
      coverError.value = errorMessage(e)
      if (e instanceof ApiError && (e.status === 401 || e.code === 'PROFILE_INCOMPLETE')) loginPage(target.value)
    }
  } finally {
    if (current()) { busy.value = false; uploadingCover.value = false }
  }
}
function previewCover() {
  if (coverUrl.value) uni.previewImage({ urls: [mediaUrl(coverUrl.value)] })
}
function setCapacityLimited(limited: boolean) {
  if (busy.value || !editable.value || started.value) return
  if (!limited) form.capacity = ''
  capacityLimited.value = limited
}
function beginQuestion(question?: DraftQuestion) {
  if (busy.value || locked.value || !editable.value || (!question && questions.value.length >= 100)) return
  questionError.value = ''
  editingQuestion.value = question ? { ...question } : { key: ++sequence, prompt: '', type: 'short_text', required: false, options: '' }
}
function saveQuestion() {
  if (!editingQuestion.value || busy.value || locked.value || !editable.value) return
  const draft = { ...editingQuestion.value, prompt: editingQuestion.value.prompt.trim() }
  if (!draft.prompt) { questionError.value = '请填写题目'; return }
  if (draft.type === 'single' || draft.type === 'multiple') {
    const options = draft.options.split('\n').map(item => item.trim()).filter(Boolean)
    if (!options.length || options.length > 100 || options.some(item => item.length > 200) || new Set(options).size !== options.length) {
      questionError.value = '请填写1–100个不同选项，每行一个，每项最多200字'; return
    }
    draft.options = options.join('\n')
  } else draft.options = ''
  const index = questions.value.findIndex(question => question.key === draft.key)
  if (index >= 0) questions.value[index] = draft
  else if (questions.value.length < 100) questions.value.push(draft)
  editingQuestion.value = null
}
function removeQuestion(key: number) {
  if (busy.value || locked.value || !editable.value) return
  const index = questions.value.findIndex(question => question.key === key)
  if (index >= 0) questions.value.splice(index, 1)
}
function moveQuestion(from: number, to: number) {
  if (busy.value || locked.value || !editable.value || from < 0 || from >= questions.value.length || to < 0 || to >= questions.value.length || from === to) return
  const [question] = questions.value.splice(from, 1)
  questions.value.splice(to, 0, question)
}
type DragEvent = { touches?: ArrayLike<{ clientY: number }> }
function startQuestionDrag(index: number, event: DragEvent) {
  if (busy.value || locked.value || !editable.value || !event.touches?.length) return
  dragIndex.value = index
  dragStartY = event.touches[0].clientY
  dragRowHeight = uni.getSystemInfoSync().windowWidth * 120 / 750
  dragOffset.value = 0
  suppressSortMenu = false
}
function moveQuestionDrag(event: DragEvent) {
  if (dragIndex.value < 0 || !event.touches?.length) return
  dragOffset.value = event.touches[0].clientY - dragStartY
}
function endQuestionDrag() {
  if (dragIndex.value < 0) return
  const from = dragIndex.value
  const to = Math.max(0, Math.min(questions.value.length - 1, from + Math.round(dragOffset.value / dragRowHeight)))
  suppressSortMenu = Math.abs(dragOffset.value) > 5
  moveQuestion(from, to)
  dragIndex.value = -1
  dragOffset.value = 0
}
function showSortMenu(index: number) {
  if (suppressSortMenu) { suppressSortMenu = false; return }
  if (busy.value || locked.value || !editable.value) return
  const token = session.token, epoch = session.epoch, key = questions.value[index]?.key
  uni.showActionSheet({ itemList: ['上移一位', '下移一位'], success: result => {
    if (disposed || token !== session.token || epoch !== session.epoch) return
    const current = questions.value.findIndex(question => question.key === key)
    moveQuestion(current, current + (result.tapIndex === 0 ? -1 : 1))
  } })
}
function showSettingsHelp(kind: 'capacity' | 'deadline' | 'phone') {
  const content = kind === 'capacity' ? '人数上限不能低于当前有效报名人数。选择不限制后不设人数上限。' : kind === 'deadline' ? '设置时间时，最晚在活动开始时截止；不设提前截止时间时，满员暂停报名，有名额后可恢复，活动开始后截止。' : '手机号是报名必填字段，参与者可填写本次活动的联系手机号，不改变其账号绑定手机号。'
  uni.showModal({ title: kind === 'phone' ? '联系手机号' : '报名设置说明', content, showCancel: false })
}
function openDate(field: 'start' | 'end' | 'deadline') {
  if (busy.value || !editable.value || started.value) return
  dateField.value = field
  const today = dateParts(new Date().toISOString())
  pickerDate.value = form[field + 'Date' as 'startDate'] || today.date
  pickerTime.value = form[field + 'Time' as 'startTime'] || '09:00'
}
function confirmDate() {
  if (!dateField.value || !timestamp(pickerDate.value, pickerTime.value)) return
  const field = dateField.value
  form[field + 'Date' as 'startDate'] = pickerDate.value
  form[field + 'Time' as 'startTime'] = pickerTime.value
  if (field === 'deadline') customDeadline.value = true
  dateField.value = null
}
function clearDeadline() {
  customDeadline.value = false
  dateField.value = null
}
function displayTime(field: 'start' | 'end' | 'deadline') {
  const date = form[field + 'Date' as 'startDate'], time = form[field + 'Time' as 'startTime']
  return date && time ? date.replaceAll('-', '.') + ' ' + time : '选择日期和时间'
}
function changeStep(value: number) {
  if (busy.value) return
  step.value = value
  submitError.value = ''
  uni.pageScrollTo({ scrollTop: 0, duration: 0 })
}
async function confirmPublish() {
  if (step.value !== 2 || busy.value || !editable.value) return
  if (!reviewed.value) { submitError.value = '请先核对活动信息与费用说明'; return }
  await submit(source.value?.lifecycle !== 'published')
}
function showPublishInformation() {
  uni.showModal({ title: '发布说明', content: '请核对活动时间、地点、咨询方式和报名设置。首次报名后，题目及费用模式和金额将锁定。' + feeDisclaimer + '。', showCancel: false })
}
async function focusLocation() {
  locationFocus.value = false
  await nextTick()
  locationFocus.value = true
}
function switchValue(event: unknown): boolean {
  return (event as { detail: { value: boolean } }).detail.value
}
async function submit(publish = false) {
  if (busy.value || loading.value || error.value || !editable.value || disposed) return
  const request = ++generation, token = session.token, epoch = session.epoch
  const current = () => request === generation && !disposed && token === session.token && epoch === session.epoch
  submitError.value = ''
  let input: ActivityWriteInput
  try { input = payload() } catch (e) { submitError.value = errorMessage(e); return }
  busy.value = true
  try {
    if (publish) {
      const confirmed = await new Promise<boolean>(resolve => uni.showModal({ title: '确认发布活动', content: '发布后会员即可浏览和报名，请确认时间、地点与费用信息准确。', confirmText: '发布', success: result => resolve(!!result.confirm), fail: () => resolve(false) }))
      if (!confirmed || !current()) return
    }
    if (!await requireProfile(target.value) || !current()) return
    if (formOwner !== (useSessionStore().member?.id || '')) { reset(); error.value = '登录身份已变更，请重新填写活动'; return }
    const activity = id.value ? await api.updateActivity(id.value, input) : await api.createActivity(input)
    if (!current()) return
    id.value = activity.id
    source.value = activity
    questions.value = activity.questions.map(question => ({ key: ++sequence, id: question.id, prompt: question.prompt, type: question.type as QuestionType, required: question.required, options: (question.options || []).join('\n') }))
    if (publish) await api.publishActivity(activity.id)
    if (!current()) return
    navigate(routes.manage + '?id=' + encodeURIComponent(activity.id), true)
  } catch (e) {
    if (!current()) return
    submitError.value = errorMessage(e)
    if (e instanceof ApiError && (e.status === 401 || e.code === 'PROFILE_INCOMPLETE')) loginPage(target.value)
  } finally { if (request === generation && !disposed) busy.value = false }
}
const stopSessionWatch = watch(() => [session.token, session.epoch], () => {
  if (!formOwner || disposed) return
  generation++
  reset()
  busy.value = false
  loading.value = false
  error.value = '登录身份已变更，请重新加载后填写活动'
}, { flush: 'sync' })
onLoad(options => { id.value = String(options?.id || ''); fromAi = options?.aiDraft === '1' })
onShow(load)
onUnload(() => { disposed = true; generation++; stopSessionWatch() })
</script>

<template>
  <view
    class="activity-editor"
    :class="{ 'settings-page': step === 1, 'confirmation-page': step === 2 }"
  >
    <view class="steps">
      <button
        class="step"
        :class="{ current: step === 0, completed: step > 0 }"
        :disabled="busy"
        @click="changeStep(0)"
      >
        基本信息
      </button>
      <view
        class="step-line"
        :class="{ completed: step > 0 }"
      />
      <button
        class="step"
        :class="{ current: step === 1, completed: step > 1 }"
        :disabled="busy"
        @click="changeStep(1)"
      >
        报名设置
      </button>
      <view
        class="step-line"
        :class="{ 'muted-line': step === 0 }"
      />
      <button
        class="step last-step"
        :class="{ current: step === 2 }"
        :disabled="busy"
        @click="changeStep(2)"
      >
        确认发布
      </button>
    </view>
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    />
    <template v-if="!loading && !error">
      <view
        v-if="aiDraftMissing"
        class="notice"
      >
        AI 草稿已失效，你可以手动填写活动，或返回助手重新生成。
      </view>
      <view
        v-if="aiDraftApplied"
        class="notice"
      >
        AI 草稿已填入，请核对全部内容。封面可手动设置，咨询联系方式需补齐；报名问题的题型、必填和选项也请逐一确认。
      </view>
      <view
        v-if="!editable"
        class="notice"
      >
        当前活动状态不允许修改，请返回管理页查看。
      </view>
      <view
        v-if="started && editable"
        class="notice"
      >
        活动已开始，仅可修改咨询联系方式。
      </view>
      <view
        v-show="step === 0"
        class="basic-information"
      >
        <view class="form-card type-card">
          <view class="card-heading"><text>活动类型</text><text class="helper">选择活动类型</text></view>
          <view class="activity-types">
            <button
              class="type-option"
              :class="{ selected: form.feeType === 'free' }"
              :disabled="busy || locked || !editable"
              @click="form.feeType = 'free'"
            >
              <view class="radio-dot" /><view><text class="type-name">免费活动</text><text class="type-note">不收取费用，开放更多同行参与</text></view>
            </button>
            <button
              class="type-option"
              :class="{ selected: form.feeType === 'paid' }"
              :disabled="busy || locked || !editable"
              @click="form.feeType = 'paid'"
            >
              <view class="radio-dot" /><view><text class="type-name">收费活动</text><text class="type-note">设置参与费用，筛选更精准的参与者</text></view>
            </button>
          </view>
          <view
            v-if="form.feeType === 'paid'"
            class="paid-details"
          >
            <view class="amount-row">
              <text class="amount-label">参与费用</text>
              <view class="amount-control">
                <text class="amount-currency">¥</text>
                <input
                  v-model="form.amount"
                  class="amount-input"
                  type="digit"
                  placeholder="请输入金额"
                  :maxlength="12"
                  :disabled="busy || locked || !editable"
                  :cursor-spacing="130"
                >
                <text class="amount-unit">元 / 人</text>
              </view>
            </view>
            <view class="helper fee-hint">{{ feeDisclaimer }}</view>
          </view>
          <view
            v-if="locked"
            class="helper lock-hint"
          >
            已有报名或活动已开始，费用模式及金额不可修改。
          </view>
        </view>
        <view class="form-card title-card">
          <view class="card-heading"><text>活动标题 <text class="required">*</text></text><text class="helper">{{ form.title.length }}/{{ Math.max(50, source?.title.length || 0) }}</text></view>
          <input
            v-model="form.title"
            class="field"
            placeholder="请输入活动标题，例如：地产行业AI应用实战分享"
            :maxlength="Math.max(50, source?.title.length || 0)"
            :disabled="busy || !editable || started"
            :cursor-spacing="130"
          >
        </view>
        <view class="form-card cover-card">
          <view class="card-heading"><text>活动封面</text><text class="helper">上传高质量封面，建议尺寸 16:9</text></view>
          <view class="cover-row">
            <image
              v-if="coverUrl"
              class="cover-image"
              :src="mediaUrl(coverUrl)"
              mode="aspectFill"
              @click="previewCover"
            />
            <view
              v-else
              class="cover-empty"
            >
              <uni-icons
                type="image"
                size="48rpx"
                color="#8a96a7"
              /><text>尚未设置封面</text><text class="cover-optional">选填</text>
            </view>
            <button
              class="cover-button"
              :disabled="busy || started || !editable"
              :loading="uploadingCover"
              @click="changeCover"
            >
              <uni-icons
                type="camera"
                size="42rpx"
                color="#788599"
              /><text>{{ uploadingCover ? '正在上传' : coverUrl ? '更换封面' : '上传封面' }}</text><text class="helper">PNG / JPG · 2 MB 内</text>
            </button>
          </view>
        </view>
        <view
          v-if="coverError"
          class="notice"
        >
          {{ coverError }}，可重新选择上传。
        </view>
        <view class="form-card description-card">
          <view class="card-heading"><text>活动介绍 <text class="required">*</text></text><text class="helper">{{ form.description.length }}/{{ Math.max(1000, source?.description.length || 0) }}</text></view>
          <view class="description-box">
            <view
              class="format-toolbar"
              aria-label="富文本功能暂未开放，目前支持文字输入"
            >
              <text class="format-bold">B</text><text class="format-italic">I</text><text class="format-underline">U</text><view class="toolbar-divider" /><uni-icons
                type="list"
                size="29rpx"
                color="#8993a2"
              /><uni-icons
                type="list"
                size="29rpx"
                color="#8993a2"
              /><uni-icons
                type="link"
                size="29rpx"
                color="#8993a2"
              /><view class="toolbar-divider" /><uni-icons
                type="image"
                size="29rpx"
                color="#8993a2"
              /><text class="toolbar-note">仅文字</text>
            </view>
            <textarea
              v-model="form.description"
              class="description-input"
              placeholder="请详细介绍本次活动的内容、亮点、适合人群等..."
              :maxlength="Math.max(1000, source?.description.length || 0)"
              :disabled="busy || !editable || started"
              :cursor-spacing="130"
            />
          </view>
        </view>
        <view class="form-card time-card">
          <view class="card-heading"><text>活动时间 <text class="required">*</text></text></view>
          <view class="event-times">
            <button
              class="time-control"
              :disabled="busy || !editable || started"
              @click="openDate('start')"
            >
              <view class="time-copy"><text class="helper">开始时间</text><text>{{ displayTime('start') }}</text></view><uni-icons
                type="right"
                size="24rpx"
                color="#8b97aa"
              />
            </button>
            <text class="time-separator">—</text>
            <button
              class="time-control end-time"
              :disabled="busy || !editable || started"
              @click="openDate('end')"
            >
              <view class="time-copy"><text class="helper">结束时间</text><text>{{ displayTime('end') }}</text></view><uni-icons
                type="right"
                size="24rpx"
                color="#8b97aa"
              />
            </button>
          </view>
        </view>
        <view class="form-card location-card">
          <view class="card-heading">
            <text>活动地点 <text class="required">*</text></text><button
              class="location-link"
              :disabled="busy || !editable || started"
              @click="focusLocation"
            >
              填写地点
            </button>
          </view>
          <view class="field icon-field">
            <uni-icons
              type="location"
              size="34rpx"
            /><input
              v-model="form.location"
              placeholder="请输入活动地点"
              :focus="locationFocus"
              :maxlength="500"
              :disabled="busy || !editable || started"
              :cursor-spacing="130"
              @blur="locationFocus = false"
            ><uni-icons
              type="right"
              size="24rpx"
              color="#8b97aa"
            />
          </view>
          <view class="field-note">请填写详细地址，地图选点暂未开放</view>
        </view>
        <view class="two-column">
          <view class="form-card capacity-card">
            <view class="card-heading"><text>活动人数</text></view><view class="field icon-field">
              <uni-icons
                type="personadd"
                size="32rpx"
              /><input
                v-model="form.capacity"
                type="number"
                placeholder="不限人数"
                :maxlength="10"
                :disabled="busy || !editable || started"
                :cursor-spacing="130"
              ><text>人</text>
            </view>
          </view>
          <view class="form-card deadline-card">
            <view class="card-heading"><text>报名截止时间</text></view><button
              class="field deadline-control"
              :disabled="busy || !editable || started"
              @click="openDate('deadline')"
            >
              <view class="clock-icon" /><text>{{ customDeadline ? displayTime('deadline') : '活动开始时截止' }}</text><uni-icons
                type="right"
                size="24rpx"
                color="#8b97aa"
              />
            </button>
          </view>
        </view>
        <view class="form-card contact-card">
          <view class="card-heading"><text>咨询联系方式 <text class="required">*</text></text></view><view class="field icon-field">
            <uni-icons
              type="phone"
              size="32rpx"
            /><input
              v-model="form.consultationContact"
              placeholder="请输入联系电话或微信号"
              :maxlength="1000"
              :disabled="busy || !editable"
              :cursor-spacing="130"
            >
          </view><view class="field-note">用于参与者咨询活动相关问题，仅对报名用户可见</view>
        </view>
      </view>
      <view
        v-show="step === 1"
        class="registration-settings"
      >
        <view class="settings-card required-card">
          <view class="settings-heading">
            <text>需要报名</text><view
              class="registration-switch"
              role="switch"
              aria-checked="true"
              aria-disabled="true"
            >
              <view />
            </view>
          </view>
          <view class="settings-description">开启后，参与者需填写报名信息才能参加活动</view>
          <view class="settings-note">当前活动统一需要报名，暂不支持关闭</view>
        </view>
        <view class="settings-card">
          <view class="settings-heading">
            <text>报名人数限制</text><button
              class="help-button"
              aria-label="人数限制说明"
              @click="showSettingsHelp('capacity')"
            >
              ?
            </button>
          </view>
          <view class="settings-options">
            <view class="option-pair">
              <button
                class="settings-option"
                :class="{ selected: capacityLimited }"
                :disabled="busy || !editable || started"
                @click="setCapacityLimited(true)"
              >
                <view class="radio-dot" />限制人数
              </button>
              <button
                class="settings-option"
                :class="{ selected: !capacityLimited }"
                :disabled="busy || !editable || started"
                @click="setCapacityLimited(false)"
              >
                <view class="radio-dot" />不限制
              </button>
            </view>
            <view class="setting-value">
              <text class="helper">人数上限</text><view class="setting-input">
                <input
                  v-model="form.capacity"
                  type="number"
                  :placeholder="capacityLimited ? '请输入人数' : '不限人数'"
                  :maxlength="10"
                  :disabled="!capacityLimited || busy || !editable || started"
                  :cursor-spacing="130"
                ><text>人</text>
              </view>
            </view>
          </view>
        </view>
        <view class="settings-card">
          <view class="settings-heading">
            <text>报名截止时间</text><button
              class="help-button"
              aria-label="截止时间说明"
              @click="showSettingsHelp('deadline')"
            >
              ?
            </button>
          </view>
          <view class="settings-options">
            <view class="option-pair">
              <button
                class="settings-option"
                :class="{ selected: customDeadline }"
                :disabled="busy || !editable || started"
                @click="openDate('deadline')"
              >
                <view class="radio-dot" />按时间截止
              </button>
              <button
                class="settings-option"
                :class="{ selected: !customDeadline }"
                :disabled="busy || !editable || started"
                @click="clearDeadline"
              >
                <view class="radio-dot" />{{ capacityLimited ? '报满截止' : '开始时截止' }}
              </button>
            </view>
            <view class="setting-value">
              <text class="helper">截止时间</text><button
                class="setting-input settings-date"
                :disabled="busy || !editable || started"
                @click="openDate('deadline')"
              >
                <view class="clock-icon" /><text>{{ customDeadline ? displayTime('deadline') : '活动开始时截止' }}</text><uni-icons
                  type="right"
                  size="24rpx"
                  color="#7b889d"
                />
              </button>
            </view>
          </view>
          <view
            v-if="!customDeadline"
            class="settings-note"
          >
            {{ capacityLimited ? '满员暂停报名，有名额后可恢复；最晚于活动开始时截止' : '未设置提前截止时间，活动开始后不再接受报名' }}
          </view>
        </view>
        <view class="settings-card questions-card">
          <view class="settings-heading"><text>报名信息收集</text><text class="helper sorting-note">{{ locked ? '已有报名，问题及顺序已锁定' : '拖动左侧图标可调整问题顺序' }}</text></view>
          <view class="settings-description">添加自定义问题，收集参与者信息（至少保留手机号）</view>
          <view class="question-list">
            <button
              class="question-row system-question"
              @click="showSettingsHelp('phone')"
            >
              <view class="question-handle fixed-handle">
                <uni-icons
                  type="list"
                  size="29rpx"
                  color="#7c8a9e"
                />
              </view><view class="question-copy"><view class="question-title"><text>手机号</text><text class="require-badge">必填</text></view><text class="question-subtitle">用于活动联系</text></view><text class="system-badge">系统字段</text><uni-icons
                type="right"
                size="24rpx"
                color="#7b889d"
              />
            </button>
            <view
              v-for="(question,index) in questions"
              :key="question.key"
              class="question-row"
              :class="{ dragging: dragIndex === index }"
              :style="dragIndex === index ? { transform: 'translateY(' + dragOffset + 'px)' } : {}"
            >
              <button
                class="question-handle"
                :disabled="busy || locked || !editable"
                aria-label="调整问题顺序"
                @touchstart.stop="startQuestionDrag(index,$event)"
                @touchmove.stop.prevent="moveQuestionDrag($event)"
                @touchend.stop="endQuestionDrag"
                @touchcancel="dragIndex = -1; dragOffset = 0"
                @click="showSortMenu(index)"
              >
                <uni-icons
                  type="list"
                  size="29rpx"
                  color="#7c8a9e"
                />
              </button>
              <button
                class="question-open"
                :disabled="busy || locked || !editable"
                @click="beginQuestion(question)"
              >
                <view class="question-copy">
                  <view class="question-title">
                    <text class="question-prompt">{{ index + 1 }}. {{ question.prompt || '未填写题目' }}</text><text
                      class="require-badge"
                      :class="{ optional: !question.required }"
                    >
                      {{ question.required ? '必填' : '选填' }}
                    </text>
                  </view><text class="question-subtitle">{{ questionLabels[questionTypes.indexOf(question.type)] }}</text>
                </view><uni-icons
                  type="right"
                  size="24rpx"
                  color="#7b889d"
                />
              </button>
              <button
                class="delete-question"
                :disabled="busy || locked || !editable"
                :aria-label="'删除第' + (index+1) + '题'"
                @click="removeQuestion(question.key)"
              >
                <uni-icons
                  type="trash"
                  size="31rpx"
                  color="#7b889d"
                />
              </button>
            </view>
          </view>
          <button
            class="add-question-row"
            :disabled="busy || locked || !editable || questions.length >= 100"
            @click="beginQuestion()"
          >
            <text class="plus">＋</text>添加问题
          </button>
        </view>
        <view class="settings-card notice-card">
          <view class="settings-heading"><text>报名须知</text><text class="require-badge optional">选填</text><text class="helper notice-unavailable">暂未开放</text></view><view class="settings-description">向参与者展示报名须知、费用说明等重要信息</view><view class="notice-input">
            <textarea
              disabled
              placeholder="报名须知暂未开放，当前不会保存此项内容"
              :maxlength="500"
            /><text>0/500</text>
          </view>
        </view>
      </view>
      <view
        v-show="step === 2"
        class="confirmation-content"
      >
        <view class="review-card">
          <view class="review-heading">
            <text>活动预览</text><button
              class="review-edit"
              :disabled="busy"
              @click="changeStep(0)"
            >
              <uni-icons
                type="compose"
                size="27rpx"
                color="#18a457"
              />编辑
            </button>
          </view>
          <image
            v-if="coverUrl"
            class="preview-cover"
            :src="mediaUrl(coverUrl)"
            mode="aspectFill"
          />
          <view
            v-else
            class="preview-cover empty-cover"
          >
            <uni-icons
              type="image"
              size="59rpx"
              color="#7d9d90"
            /><text>未设置活动封面</text>
          </view>
          <view class="preview-title">{{ form.title.trim() || '请补充活动标题' }}</view>
          <view class="preview-badges"><text class="preview-fee">{{ form.feeType === 'paid' ? '收费活动 · ¥' + (form.amount || '待填写') : form.feeType === 'free' ? '免费活动' : '费用待确认' }}</text><text class="preview-state">{{ source?.lifecycle === 'published' ? '已发布 · 修改预览' : '待发布' }}</text></view>
          <view class="preview-meta"><view class="clock-icon" /><text>{{ previewTime }}</text></view>
          <view class="preview-meta">
            <uni-icons
              type="location"
              size="32rpx"
              color="#164f41"
            /><text>{{ form.location.trim() || '请补充活动地点' }}</text>
          </view>
          <view class="preview-meta">
            <uni-icons
              type="personadd"
              size="32rpx"
              color="#164f41"
            /><text>{{ form.capacity ? '限额 ' + form.capacity + ' 人' : '不限人数' }} | 已报名 {{ source?.activeRegistrationCount || 0 }} 人</text>
          </view>
          <view class="preview-organizer">
            <image
              v-if="session.member?.avatarUrl"
              class="organizer-avatar"
              :src="mediaUrl(session.member.avatarUrl)"
              mode="aspectFill"
            /><view
              v-else
              class="organizer-avatar avatar-empty"
            >
              <uni-icons
                type="person"
                size="34rpx"
                color="#638375"
              />
            </view><text>发起人</text><text>{{ session.member?.displayName || '当前会员' }}</text>
          </view>
        </view>
        <view class="review-card"><view class="review-heading">活动简介</view><text class="preview-description">{{ form.description.trim() || '请补充活动介绍' }}</text></view>
        <view class="review-card">
          <view class="review-heading">
            <text>报名设置</text><button
              class="review-edit"
              :disabled="busy"
              @click="changeStep(1)"
            >
              编辑<uni-icons
                type="compose"
                size="27rpx"
                color="#18a457"
              />
            </button>
          </view>
          <view class="review-detail">
            <uni-icons
              type="list"
              size="32rpx"
              color="#164f41"
            /><view><text class="review-label">需要报名</text><text class="review-muted">参与者需填写报名表才能参加活动</text></view>
          </view>
          <view class="review-detail">
            <uni-icons
              type="personadd"
              size="32rpx"
              color="#164f41"
            /><view><text class="review-label">人数限制</text><text class="review-muted">{{ form.capacity ? '限额 ' + form.capacity + ' 人' : '不限人数' }}</text></view>
          </view>
          <view class="review-detail"><view class="clock-icon" /><view><text class="review-label">报名截止时间</text><text class="review-muted">{{ customDeadline ? displayTime('deadline') + '（按时间截止）' : '活动开始时截止' }}</text></view></view>
          <view class="review-detail">
            <uni-icons
              type="list"
              size="32rpx"
              color="#164f41"
            /><view><text class="review-label">报名信息收集</text><text class="review-muted">共 {{ questions.length + 1 }} 项（含手机号{{ previewQuestionTypes ? '、' + previewQuestionTypes : '' }}）</text></view>
          </view>
          <view class="review-detail">
            <uni-icons
              type="list"
              size="32rpx"
              color="#164f41"
            /><view><text class="review-label">报名须知</text><text class="review-muted">未设置（暂未开放）</text></view>
          </view>
        </view>
        <view class="review-card">
          <view class="review-heading">
            <text>其他信息</text><button
              class="review-edit"
              :disabled="busy"
              @click="changeStep(0)"
            >
              编辑<uni-icons
                type="compose"
                size="27rpx"
                color="#18a457"
              />
            </button>
          </view>
          <view class="review-detail">
            <uni-icons
              type="phone"
              size="32rpx"
              color="#164f41"
            /><view><text class="review-label">咨询联系方式</text><text class="review-muted">{{ form.consultationContact.trim() || '请补充联系电话或微信号' }}</text></view>
          </view>
          <view class="review-detail">
            <uni-icons
              type="checkmarkempty"
              size="32rpx"
              color="#164f41"
            /><view><text class="review-label">活动声明</text><text class="review-muted">{{ form.feeType === 'free' ? '本活动为免费活动，会聚不收取任何费用。' : form.feeType === 'paid' ? feeDisclaimer + '。' : '请先确认活动费用模式' }}</text></view>
          </view>
        </view>
      </view>
      <view
        v-if="submitError"
        class="error submit-error"
      >
        {{ submitError }}
      </view>
      <view
        class="editor-footer"
        :class="{ 'review-footer': step === 2 }"
      >
        <view
          v-if="step === 2"
          class="review-agreement"
        >
          <button
            class="review-checkbox"
            role="checkbox"
            :aria-checked="reviewed"
            :class="{ checked: reviewed }"
            :disabled="busy || !editable"
            aria-label="我已核对活动信息与费用说明"
            @click="reviewed = !reviewed"
          >
            <uni-icons
              v-if="reviewed"
              type="checkmarkempty"
              size="24rpx"
              color="#fff"
            />
          </button><text>我已核对活动信息与费用说明</text><button
            class="review-guidance"
            @click="showPublishInformation"
          >
            发布说明
          </button>
        </view>
        <view class="footer-actions">
          <button
            v-if="step === 0"
            class="draft-button"
            :loading="busy"
            :disabled="busy || !editable"
            @click="submit(false)"
          >
            {{ source?.lifecycle === 'published' ? '保存修改' : '保存草稿' }}
          </button>
          <button
            v-else
            class="draft-button"
            :disabled="busy"
            @click="changeStep(step - 1)"
          >
            {{ step === 2 ? '上一步：报名设置' : '上一步：基本信息' }}
          </button>
          <button
            v-if="step < 2"
            class="next-button"
            :disabled="busy || !editable"
            @click="changeStep(step + 1)"
          >
            {{ step === 0 ? '下一步：报名设置' : '下一步：确认发布' }} <text class="arrow">→</text>
          </button>
          <button
            v-else
            class="next-button"
            :loading="busy"
            :disabled="busy || !editable || !reviewed"
            @click="confirmPublish"
          >
            {{ source?.lifecycle === 'published' ? '确认保存' : '确认发布' }}
          </button>
        </view>
      </view>
    </template>
    <view
      v-if="editingQuestion"
      class="date-mask question-mask"
      @click.self="editingQuestion = null"
    >
      <view class="date-sheet question-sheet">
        <view class="date-sheet-title">
          <text>{{ questions.some(q => q.key === editingQuestion?.key) ? '编辑问题' : '添加问题' }}</text><button
            class="close-question"
            @click="editingQuestion = null"
          >
            取消
          </button>
        </view>
        <view class="question-form-label">题目 <text class="required">*</text></view><input
          v-model="editingQuestion.prompt"
          class="field"
          placeholder="请输入题目"
          :maxlength="1000"
          :cursor-spacing="130"
        >
        <view class="question-form-options">
          <picker
            :range="questionLabels"
            :value="questionTypes.indexOf(editingQuestion.type)"
            @change="editingQuestion.type = questionTypes[Number($event.detail.value)]"
          >
            <view>
              题型：{{ questionLabels[questionTypes.indexOf(editingQuestion.type)] }} <uni-icons
                type="bottom"
                size="28rpx"
              />
            </view>
          </picker><view class="question-required">
            <text>必填</text><switch
              :checked="editingQuestion.required"
              color="#20865e"
              @change="editingQuestion.required = switchValue($event)"
            />
          </view>
        </view>
        <template v-if="editingQuestion.type === 'single' || editingQuestion.type === 'multiple'">
          <view class="question-form-label">选项</view><textarea
            v-model="editingQuestion.options"
            class="field question-options-input"
            placeholder="每行一个选项，至少填写一项"
            :maxlength="20100"
            :cursor-spacing="130"
          />
        </template>
        <view
          v-if="questionError"
          class="error"
        >
          {{ questionError }}
        </view><button
          class="next-button save-question"
          :disabled="busy || locked || !editable"
          @click="saveQuestion"
        >
          保存问题
        </button>
      </view>
    </view>
    <view
      v-if="dateField"
      class="date-mask"
    >
      <view class="date-sheet">
        <view class="date-sheet-title">{{ dateField === 'start' ? '开始时间' : dateField === 'end' ? '结束时间' : '报名截止时间' }}<text class="helper">北京时间</text></view>
        <view class="date-pickers">
          <picker
            mode="date"
            :value="pickerDate"
            @change="pickerDate = String($event.detail.value)"
          >
            <view class="field">{{ pickerDate }}</view>
          </picker><picker
            mode="time"
            :value="pickerTime"
            @change="pickerTime = String($event.detail.value)"
          >
            <view class="field">{{ pickerTime }}</view>
          </picker>
        </view>
        <button
          v-if="dateField === 'deadline'"
          class="clear-deadline"
          @click="clearDeadline"
        >
          不提前截止，使用活动开始时间
        </button>
        <view class="date-actions">
          <button
            class="draft-button"
            @click="dateField = null"
          >
            取消
          </button><button
            class="next-button"
            @click="confirmDate"
          >
            确定
          </button>
        </view>
      </view>
    </view>
  </view>
</template>
<style scoped>
.activity-editor{min-height:100vh;background:#f4f9f7;color:#111a2d;padding:20rpx 47rpx calc(106rpx + env(safe-area-inset-bottom));font-size:27rpx;line-height:1.45}
.steps{display:flex;align-items:center;justify-content:space-between;gap:10rpx;height:72rpx;margin:0 55rpx 16rpx}.step{flex-shrink:0;white-space:nowrap;font-size:27rpx;font-weight:500;line-height:51rpx;padding:0 20rpx;background:transparent;color:#717b90;border-radius:30rpx}.step.current{background:linear-gradient(110deg,#318e6f,#135741);color:#fff}.step.completed{color:#197757}.last-step{padding-right:0}.step-line{height:2rpx;background:#55a891;flex:1;min-width:24rpx}.muted-line{background:#cbd2dd}
.form-card{background:#fff;border-radius:11rpx;padding:17rpx 18rpx;margin-bottom:14rpx}.card-heading{display:flex;align-items:center;justify-content:space-between;gap:8rpx;font-size:30rpx;line-height:42rpx;font-weight:600;margin-bottom:10rpx}.helper{font-size:24rpx;color:#7b879d;font-weight:400;line-height:1.5}.required{margin-left:3rpx;margin-right:0;color:#ea2027}.field{display:block;background:linear-gradient(110deg,#f7f9fa,#f5f7f8);border:1rpx solid #edf0f3;border-radius:8rpx;min-height:66rpx;height:66rpx;line-height:66rpx;width:100%;padding:0 15rpx;font-size:27rpx;color:#172239}.field::placeholder,.description-input::placeholder{color:#8c96a8}
.type-card{padding-top:14rpx;padding-bottom:15rpx}.type-card .card-heading{margin-bottom:17rpx}.activity-types{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:19rpx}.type-option{display:flex;align-items:flex-start;gap:14rpx;text-align:left;border:1rpx solid #e0e6ed;background:#fafbfc;border-radius:7rpx;padding:20rpx 17rpx;min-height:117rpx;font-size:27rpx;line-height:1.6}.type-option.selected{border-color:#298363;background:#f6faf8}.type-name{display:block;font-size:30rpx;font-weight:600;white-space:nowrap}.type-note{display:block;font-size:24rpx;color:#768399;white-space:nowrap;letter-spacing:-.35rpx}.radio-dot{width:19rpx;height:29rpx;border:1.5rpx solid #9aa5b7;border-radius:50%;margin-top:7rpx;flex-shrink:0}.selected .radio-dot{border:6rpx solid #2b8064}.paid-details{margin-top:17rpx}.amount-row{display:flex;flex-direction:column;gap:10rpx}.amount-label{font-size:27rpx;font-weight:600;color:#263c35}.amount-control{display:flex;align-items:center;gap:12rpx;min-height:78rpx;padding:0 20rpx;border:1rpx solid #d9e5e1;border-radius:10rpx;background:#f7faf8}.amount-currency{font-size:30rpx;font-weight:600;color:#2b8064}.amount-input{flex:1;min-width:0;height:78rpx;font-size:30rpx;color:#263c35}.amount-unit{flex:none;font-size:25rpx;color:#667c73;white-space:nowrap}.fee-hint,.lock-hint{margin-top:11rpx;font-size:23rpx}.title-card{padding-top:11rpx;padding-bottom:11rpx}
.cover-card{padding-top:11rpx;padding-bottom:11rpx}.cover-row{display:grid;grid-template-columns:2.1fr 1fr;gap:13rpx}.cover-image,.cover-empty,.cover-button{height:191rpx;border-radius:7rpx;width:100%}.cover-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8rpx;background:#edf3f2;color:#7a8894}.cover-optional{font-size:21rpx;color:#99a4af}.cover-button[disabled]{background:#fafbfc;color:#788599;border:1rpx dashed #cfd7e2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5rpx;font-size:27rpx;line-height:1.4}.unavailable-label{font-size:20rpx;color:#97a0ad}
.description-box{border:1rpx solid #e2e7ee;border-radius:8rpx;overflow:hidden}.format-toolbar{height:63rpx;display:flex;align-items:center;gap:26rpx;padding:0 20rpx;background:#f5f7f9;border-bottom:1rpx solid #e3e8ef;color:#8993a2;font-size:32rpx}.format-bold{font-weight:700}.format-italic{font-family:Georgia,serif;font-style:italic}.format-underline{text-decoration:underline}.toolbar-divider{width:1rpx;height:29rpx;background:#dfe5ed}.toolbar-note{font-size:20rpx;margin-left:auto;white-space:nowrap}.description-input{font-size:27rpx;padding:14rpx 15rpx;height:110rpx;min-height:110rpx;width:100%;line-height:1.6;background:#fcfdfd}
.time-card{padding-top:12rpx;padding-bottom:12rpx}.event-times{display:flex;align-items:center;gap:20rpx}.time-control{display:flex;align-items:center;gap:12rpx;flex:1;min-width:0;background:#f6f8fa;border-radius:8rpx;padding:13rpx 16rpx;height:95rpx;text-align:left;font-size:27rpx}.time-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:3rpx;white-space:nowrap}.time-separator{color:#9ba7ba}.end-time{padding-left:18rpx}.time-control:first-child::before,.clock-icon{content:'';display:block;width:17rpx;height:26rpx;border:1.6rpx solid #172239;border-radius:50%;flex-shrink:0;background:linear-gradient(#172239,#172239) 50% 25% / 1.3rpx 6rpx no-repeat,linear-gradient(35deg,transparent 40%,#172239 42%,#172239 59%,transparent 62%) 70% 65% / 6rpx 4rpx no-repeat}
.location-link{background:transparent;color:#14745a;border-radius:0;padding:0;font-size:26rpx;line-height:42rpx}.icon-field{display:flex;align-items:center;gap:23rpx}.icon-field input{width:0;flex:1;min-width:0;font-size:27rpx;line-height:66rpx;height:66rpx}.field-note{color:#7d899c;font-size:23rpx;margin:3rpx 0 0 61rpx;line-height:33rpx}.two-column{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:9rpx}.two-column .form-card{min-width:0;padding:11rpx 16rpx 14rpx}.two-column .card-heading{margin-bottom:6rpx}.two-column .field{height:60rpx;min-height:60rpx;line-height:60rpx;padding:0 13rpx}.two-column .icon-field{gap:23rpx}.deadline-control{display:flex;align-items:center;gap:13rpx;white-space:nowrap}.deadline-control text{flex:1;text-align:left;font-size:26rpx;letter-spacing:-.6rpx}.contact-card{padding-top:7rpx;padding-bottom:7rpx}.contact-card .card-heading{margin-bottom:6rpx}
.editor-footer{position:fixed;z-index:5;bottom:0;left:0;right:0;padding:11rpx 52rpx calc(13rpx + env(safe-area-inset-bottom));background:#fff;display:flex;gap:13rpx}.editor-footer button{height:77rpx;line-height:77rpx;font-size:29rpx;font-weight:500;padding:0 15rpx;border-radius:40rpx;white-space:nowrap}.draft-button{background:#edf5f2;color:#154e41;flex:0.42}.next-button{background:linear-gradient(110deg,#2d8c6c,#15573f);color:white;flex:0.58}.arrow{margin-left:10rpx;font-size:36rpx}.submit-error{margin:10rpx 0}.registration-settings{font-size:39rpx}.registration-settings .card{padding:34rpx}.hint{color:#7c8490;font-size:36rpx;line-height:1.65;margin-top:20rpx}.question{border-top:1rpx solid #edf1ee;padding-top:20rpx;margin-top:34rpx}.question>.input{margin-top:17rpx}.question-settings{margin:12rpx 0}.type-label{padding:22rpx 0;color:#24684f;min-width:120rpx}.add-question{margin-top:34rpx;width:100%}.section-title .small{font-weight:400}
.date-mask{position:fixed;inset:0;z-index:10;background:#17283266;display:flex;align-items:flex-end}.date-sheet{width:100%;background:#fff;border-radius:24rpx 24rpx 0 0;padding:42rpx 30rpx calc(30rpx + env(safe-area-inset-bottom));font-size:39rpx}.date-sheet-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:34rpx}.date-sheet .helper{font-size:35rpx}.date-pickers,.date-actions{display:flex;gap:20rpx}.date-pickers picker{flex:1}.date-sheet .field{height:120rpx;line-height:120rpx;font-size:42rpx}.date-actions{margin-top:34rpx}.date-actions button{flex:1;padding:25rpx;font-size:42rpx}.clear-deadline{font-size:36rpx;background:transparent;color:#247757;padding:28rpx 0}
@media(max-width:360px){.activity-editor{padding-left:28rpx;padding-right:28rpx}.steps{margin-left:25rpx;margin-right:25rpx}.type-option{padding-left:12rpx;padding-right:8rpx;gap:10rpx}.type-note{font-size:23rpx}.format-toolbar{gap:22rpx}.editor-footer{padding-left:28rpx;padding-right:28rpx}}

.settings-page{padding-left:26rpx;padding-right:26rpx}.settings-page .steps{margin-left:75rpx;margin-right:75rpx}.settings-page .editor-footer{padding-left:28rpx;padding-right:28rpx}.settings-page .editor-footer .draft-button{flex:.45}.settings-page .editor-footer .next-button{flex:.55}.registration-settings{font-size:27rpx}.settings-card{padding:20rpx 20rpx;background:#fff;border-radius:10rpx;margin-bottom:17rpx}.settings-heading{display:flex;align-items:center;gap:12rpx;min-height:42rpx;font-size:30rpx;font-weight:600;margin-bottom:11rpx}.settings-description{font-size:27rpx;color:#77849a;line-height:1.55}.settings-note{font-size:20rpx;color:#8a96a6;margin-top:7rpx}.required-card .settings-heading{justify-content:space-between;margin-bottom:0}.registration-switch{width:66rpx;height:53rpx;border-radius:22rpx;background:linear-gradient(90deg,#249064,#13764e);padding:3rpx;display:flex;justify-content:flex-end}.registration-switch view{height:47rpx;width:31rpx;border-radius:50%;background:white;box-shadow:0 1rpx 4rpx #153f3a44}.help-button{font-size:23rpx;border:1.5rpx solid #8390a4;color:#8390a4;background:transparent;width:17rpx;height:26rpx;line-height:21rpx;padding:0;border-radius:50%;font-weight:500}.settings-options{display:grid;grid-template-columns:minmax(0,1.56fr) minmax(0,1fr);gap:42rpx;align-items:end}.option-pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18rpx}.settings-option{height:77rpx;display:flex;align-items:center;justify-content:center;gap:16rpx;border:1rpx solid #e5edef;background:#f9fcfc;border-radius:5rpx;padding:0 8rpx;white-space:nowrap;font-size:27rpx;line-height:1.4}.settings-option .radio-dot{margin:0;width:20rpx;height:30rpx}.setting-value{min-width:0}.setting-value>.helper{display:block;margin-bottom:4rpx}.setting-input{height:66rpx;border:1rpx solid #e5edef;border-radius:5rpx;background:#f8fbfb;display:flex;align-items:center;gap:12rpx;padding:0 16rpx;font-size:29rpx;line-height:1.4}.setting-input input{flex:1;min-width:0;width:0;font-size:29rpx}.settings-date{padding:0 14rpx;gap:12rpx;white-space:nowrap;font-size:26rpx}.settings-date text{flex:1;text-align:left;letter-spacing:-.45rpx}.sorting-note{margin-left:auto;font-size:23rpx}.questions-card .settings-heading{margin-bottom:4rpx}.question-list{margin-top:14rpx}.question-row{display:flex;align-items:center;height:102rpx;margin-bottom:6rpx;border:1rpx solid #e0eaed;border-radius:5rpx;background:#fafdfc;padding:0 14rpx 0 0;position:relative}.question-row.dragging{z-index:2;box-shadow:0 5rpx 20rpx #14584022;border-color:#31936e}.question-handle{flex-shrink:0;width:78rpx;height:99rpx;display:flex;align-items:center;justify-content:center;background:transparent;padding:0;border-radius:0;touch-action:none}.fixed-handle{width:78rpx}.system-question{text-align:left;font-size:27rpx;line-height:1.4;width:100%}.question-copy{flex:1;min-width:0;text-align:left}.question-title{display:flex;align-items:center;gap:12rpx;font-size:29rpx;line-height:42rpx}.question-prompt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.system-question .question-title{font-weight:600}.require-badge{flex-shrink:0;display:inline-block;border-radius:16rpx;background:#e6f4ee;color:#1b7250;font-size:23rpx;padding:1rpx 12rpx;line-height:33rpx;font-weight:400}.require-badge.optional{background:#eef2f4;color:#7e8999}.question-subtitle{display:block;font-size:24rpx;color:#7d899d;line-height:36rpx}.system-badge{background:#e7f3ee;color:#577278;border-radius:14rpx;font-size:23rpx;padding:4rpx 12rpx;margin-right:15rpx}.question-open{display:flex;align-items:center;gap:12rpx;flex:1;min-width:0;background:transparent;border-radius:0;padding:0;height:99rpx}.delete-question{padding:0;width:44rpx;height:84rpx;margin-left:14rpx;border-left:1rpx solid #e0e9ed;border-radius:0;background:transparent;display:flex;align-items:center;justify-content:flex-end}.add-question-row{width:100%;display:flex;align-items:center;justify-content:center;gap:16rpx;border:1rpx dashed #389e75;background:#f5fcf8;color:#137448;border-radius:4rpx;height:71rpx;font-size:29rpx;margin-top:14rpx;padding:0}.plus{font-size:44rpx;font-weight:300;line-height:1}.notice-card .settings-heading{margin-bottom:6rpx}.notice-unavailable{margin-left:auto;font-size:21rpx}.notice-input{position:relative;margin-top:7rpx;border:1rpx solid #e0e9ed;border-radius:5rpx;background:#f8fbfb;padding:14rpx 20rpx 29rpx}.notice-input textarea{width:100%;font-size:27rpx;line-height:1.5;height:50rpx;min-height:50rpx;color:#7d899d}.notice-input>text{position:absolute;right:10rpx;bottom:6rpx;font-size:23rpx;color:#7d899d}.question-mask{z-index:11}.question-sheet{max-height:85vh;overflow-y:auto}.close-question{font-size:38rpx;color:#718274;background:none;padding:0}.question-form-label{font-size:38rpx;margin-bottom:17rpx}.question-form-options{display:flex;justify-content:space-between;align-items:center;margin:24rpx 0}.question-required{display:flex;align-items:center;gap:12rpx}.date-sheet .question-options-input{height:300rpx;line-height:1.6;padding:25rpx}.save-question{width:100%;padding:25rpx;font-size:42rpx;margin-top:34rpx}
@media(max-width:360px){.settings-page .steps{margin-left:35rpx;margin-right:35rpx}.settings-options{gap:22rpx}.option-pair{gap:12rpx}.settings-option{font-size:26rpx;gap:10rpx}.settings-date{font-size:24rpx;padding:0 9rpx;gap:8rpx}.sorting-note{font-size:20rpx}.question-handle,.fixed-handle{width:58rpx}.question-title{font-size:27rpx;gap:7rpx}.require-badge{padding-left:9rpx;padding-right:9rpx}}

.footer-actions{display:flex;gap:13rpx;width:100%}.confirmation-page{padding-left:24rpx;padding-right:24rpx;padding-bottom:calc(155rpx + env(safe-area-inset-bottom));background:#f3fbf6}.confirmation-page .steps{margin-left:72rpx;margin-right:72rpx}.confirmation-page .step.current{background:linear-gradient(100deg,#23ae62,#11984c)}.confirmation-page .last-step{padding-right:20rpx}.review-card{background:white;border-radius:11rpx;padding:17rpx 21rpx;margin-bottom:17rpx}.review-heading{display:flex;align-items:center;justify-content:space-between;font-size:30rpx;font-weight:600;line-height:42rpx;margin-bottom:10rpx}.review-edit{display:flex;align-items:center;gap:7rpx;color:#18a457;font-size:26rpx;background:transparent;border-radius:0;padding:0;line-height:42rpx;font-weight:400}.preview-cover{height:269rpx;width:100%;border-radius:7rpx;display:block}.empty-cover{background:linear-gradient(115deg,#e1eee8,#f1f7f4);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12rpx;color:#7d9d90;font-size:26rpx}.preview-title{font-size:33rpx;font-weight:600;line-height:1.5;margin:10rpx 0 5rpx;overflow-wrap:anywhere}.preview-badges{display:flex;gap:11rpx;margin-bottom:13rpx}.preview-badges text{padding:4rpx 11rpx;border-radius:6rpx;font-size:27rpx;line-height:35rpx}.preview-fee{background:#fff0e4;color:#ef782f}.preview-state{background:#e8f7ee;color:#169c57}.preview-meta{display:flex;align-items:center;gap:16rpx;color:#58667d;font-size:27rpx;line-height:42rpx;margin:4rpx 0}.preview-meta>text{min-width:0;overflow-wrap:anywhere}.preview-meta .clock-icon{margin:0 3rpx;border-color:#164f41}.preview-organizer{display:flex;align-items:center;gap:13rpx;font-size:27rpx;color:#58667d;margin-top:8rpx}.organizer-avatar{width:35rpx;height:53rpx;border-radius:50%;flex-shrink:0}.avatar-empty{background:#eef4f1;display:flex;align-items:center;justify-content:center}.preview-description{display:block;white-space:pre-wrap;font-size:29rpx;line-height:1.5;color:#5c6980;overflow-wrap:anywhere}.review-detail{display:flex;align-items:flex-start;gap:22rpx;margin:7rpx 0}.review-detail>view:last-child{min-width:0;flex:1}.review-detail .clock-icon{margin:3rpx;border-color:#164f41}.review-label{display:block;font-size:27rpx;line-height:38rpx}.review-muted{display:block;color:#8a96ad;font-size:26rpx;line-height:36rpx;overflow-wrap:anywhere}.review-footer{display:block;padding:7rpx 32rpx calc(12rpx + env(safe-area-inset-bottom))}.review-agreement{display:flex;align-items:center;gap:8rpx;font-size:24rpx;margin-bottom:11rpx;line-height:42rpx}.review-footer .review-checkbox{width:23rpx;height:35rpx;line-height:30rpx;border:1rpx solid #9ebdaf;padding:0;flex:none;display:flex;align-items:center;justify-content:center;border-radius:50%;background:white}.review-footer .review-checkbox.checked{background:#1caa60;border-color:#1caa60}.review-footer .review-guidance{padding:0;color:#18a45c;background:transparent;font-size:23rpx;height:auto;line-height:42rpx;flex:none}.review-footer .draft-button{flex:1;background:#eaf6ee}.review-footer .next-button{flex:1;background:linear-gradient(110deg,#22b065,#159b4e)}.review-footer .next-button[disabled]{background:#dcece2;color:#82998c}
@media(max-width:360px){.confirmation-page .steps{margin-left:35rpx;margin-right:35rpx}.review-agreement{font-size:23rpx;gap:6rpx}.review-footer .review-guidance{font-size:21rpx}.review-detail{gap:16rpx}}

/* 微信模拟器验收尺寸：750rpx设计宽度，正文28rpx，触控区至少80rpx。 */
.activity-editor{padding-left:28rpx;padding-right:28rpx;padding-bottom:calc(150rpx + env(safe-area-inset-bottom));font-size:28rpx}.steps,.settings-page .steps,.confirmation-page .steps{margin-left:0;margin-right:0;gap:10rpx;height:80rpx;margin-bottom:20rpx}.step{font-size:28rpx;line-height:56rpx;padding:0 18rpx}.last-step{padding-right:18rpx}.step-line{min-width:12rpx}.form-card,.settings-card,.review-card{padding:22rpx 24rpx;margin-bottom:18rpx;border-radius:18rpx}.card-heading,.settings-heading,.review-heading{font-size:30rpx;line-height:44rpx;margin-bottom:14rpx}.helper{font-size:24rpx}.field{min-height:80rpx;height:80rpx;line-height:80rpx;font-size:28rpx}.icon-field input{font-size:28rpx;height:80rpx;line-height:80rpx}.activity-types{gap:16rpx}.type-option{gap:12rpx;padding:18rpx 16rpx;min-height:132rpx}.type-name{font-size:30rpx;white-space:normal}.type-note{font-size:24rpx;white-space:normal;letter-spacing:0;line-height:1.5}.radio-dot{width:30rpx;height:30rpx;margin-top:8rpx}.selected .radio-dot{border-width:9rpx}.cover-card .card-heading{flex-wrap:wrap}.cover-image,.cover-empty,.cover-button{height:190rpx}.format-toolbar{gap:24rpx;padding:0 18rpx;min-height:64rpx}.toolbar-note{font-size:22rpx}.description-input{height:180rpx;min-height:180rpx;font-size:28rpx}.event-times{gap:10rpx}.time-control{height:112rpx;padding:12rpx;gap:8rpx;font-size:24rpx}.time-copy{white-space:normal;line-height:1.5}.time-control:first-child::before{display:none}.end-time{padding-left:14rpx}.time-separator{font-size:26rpx}.icon-field{gap:16rpx}.field-note{font-size:24rpx;line-height:36rpx;margin-left:0;margin-top:10rpx}.two-column{grid-template-columns:minmax(0,1fr);gap:0}.two-column .form-card{padding:18rpx 24rpx}.two-column .field{height:80rpx;min-height:80rpx;line-height:80rpx}.deadline-control text{font-size:28rpx;letter-spacing:0}.contact-card{padding:20rpx 24rpx}.editor-footer,.settings-page .editor-footer{padding:16rpx 28rpx calc(16rpx + env(safe-area-inset-bottom))}.editor-footer button{height:84rpx;line-height:84rpx;font-size:28rpx;padding:0 16rpx}.footer-actions{gap:16rpx}.arrow{font-size:30rpx;margin-left:4rpx}.settings-options{grid-template-columns:minmax(0,1fr);gap:16rpx}.settings-option{height:80rpx;font-size:28rpx;gap:18rpx}.settings-option .radio-dot{width:30rpx;height:30rpx}.setting-value{display:flex;align-items:center;gap:20rpx}.setting-value>.helper{flex-shrink:0;width:110rpx;margin:0}.setting-input{flex:1;min-width:0;height:80rpx;font-size:28rpx}.setting-input input{font-size:28rpx}.settings-date{font-size:26rpx}.settings-date text{letter-spacing:0}.settings-description{font-size:28rpx}.settings-note{font-size:24rpx;line-height:1.5;margin-top:12rpx}.registration-switch{width:92rpx;height:52rpx;flex-shrink:0}.registration-switch view{width:48rpx;height:48rpx}.help-button{width:28rpx;height:28rpx;line-height:24rpx;font-size:22rpx}.questions-card .settings-heading{flex-wrap:wrap}.sorting-note{font-size:24rpx;margin-left:0;font-weight:400}.question-row{height:112rpx;margin-bottom:8rpx}.question-handle,.fixed-handle{width:58rpx;height:110rpx}.question-open{height:110rpx;gap:8rpx}.question-title{font-size:28rpx;line-height:40rpx;gap:8rpx}.question-subtitle{font-size:24rpx;line-height:36rpx}.require-badge{font-size:22rpx;line-height:30rpx;padding:2rpx 10rpx}.system-badge{font-size:22rpx;padding:4rpx 8rpx;margin-right:8rpx}.delete-question{width:42rpx;height:80rpx;margin-left:10rpx}.add-question-row{height:80rpx;font-size:28rpx}.notice-input textarea{font-size:26rpx;height:104rpx;min-height:104rpx}.notice-input>text{font-size:22rpx}.notice-input{padding-bottom:38rpx}.notice-unavailable{font-size:22rpx}.preview-cover{height:280rpx}.preview-title{font-size:32rpx}.preview-meta,.preview-organizer{font-size:28rpx;line-height:42rpx}.preview-description{font-size:28rpx;line-height:1.7}.preview-badges text{font-size:26rpx;line-height:34rpx}.organizer-avatar{width:56rpx;height:56rpx}.review-detail{gap:18rpx;margin:16rpx 0}.review-label{font-size:28rpx;line-height:42rpx}.review-muted{font-size:26rpx;line-height:40rpx}.review-agreement{font-size:24rpx;line-height:36rpx;flex-wrap:wrap}.review-footer .review-checkbox{width:36rpx;height:36rpx;line-height:34rpx}.review-footer .review-guidance{font-size:24rpx;line-height:36rpx;height:36rpx}.confirmation-page{padding-bottom:calc(210rpx + env(safe-area-inset-bottom))}.date-sheet .field{font-size:28rpx;height:80rpx;line-height:80rpx}.date-sheet .question-options-input{height:220rpx;line-height:1.6}.date-actions button,.save-question{font-size:28rpx;padding:20rpx}.date-sheet-title{font-size:30rpx}.question-form-label,.question-form-options,.close-question{font-size:28rpx}
</style>
