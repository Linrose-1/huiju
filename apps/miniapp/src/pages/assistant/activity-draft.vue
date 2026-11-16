<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import GatherMembershipNote from '@/components/business/GatherMembershipNote.vue'
import PageReturn from '@/components/base/PageReturn.vue'
import { api, ApiError, errorMessage } from '@/services/api'
import { API_BASE_URL } from '@/services/api/environment'
import type { ActivityWriteInput } from '@/services/api/types'
import { archiveGatherHistory, readGatherHistory, removeGatherHistory, GATHER_HISTORY_TTL } from '@/services/gather-history'
import type { GatherChatSnapshot, GatherHistoryItem } from '@/services/gather-history'
import { stageActivityDraft } from '@/services/ai-draft'
import { createGatherDraft, pendingGatherFields, gatherContext, usableModelQuestion, publicText, gatherFacts } from '@/services/gather-dialog'
import { applyGatherEdit } from '@/services/gather-edits'
import type { GatherDraft, GatherField, GatherQuestion, GatherTurn } from '@/services/gather-dialog'
import { loginPage, navigate, requireProfile, routes } from '@/services/navigation'
import { activityTimeRangeWeekday, feeDisclaimer } from '@/services/presentation'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const idea = ref('')
const draft = ref<GatherDraft | null>(null)
const reply = ref('')
const dockReply = ref('')
const custom = ref<boolean | string>(false)
const editing = ref<GatherField | null>(null)
type ChatTurn = GatherTurn & { facts?: string[]; freeEdit?: boolean }
const exchanges = ref<ChatTurn[]>([])
const sentIdea = ref('')
const openingFacts = ref<string[]>([])
const outgoing = ref<GatherTurn | null>(null)
const modelCard = ref<GatherQuestion | null>(null)
const error = ref('')
const busy = ref(false)
const checking = ref(true)
const canInitiate = ref(false)
const invitedFriend = ref(false)
function returnToAssistant() { uni.switchTab({ url: routes.assistant }) }
const accessError = ref('')
const createdId = ref('')
const uncertainCreate = ref(false)
let owner = '', version = 0, disposed = false
let persistTimer: ReturnType<typeof globalThis.setTimeout> | undefined
const storageKey = () => 'gather-dialog:v1:' + API_BASE_URL + ':' + owner
function current(request: number) {
  return !disposed && canInitiate.value && request === version && !!owner && owner === session.member?.id && !!session.token
}
function snapshot(): GatherChatSnapshot {
  return { idea: idea.value, draft: draft.value, exchanges: exchanges.value, reply: reply.value, dockReply: dockReply.value,
    sentIdea: sentIdea.value, openingFacts: openingFacts.value,
    manual:false, modelCardVersion:1, modelCard:modelCard.value, custom: custom.value, editing: editing.value, createdId: createdId.value, uncertainCreate: uncertainCreate.value }
}
const history = ref<GatherHistoryItem[]>([])
const showHistory = ref(false)
const expandedId = ref('')
let chatId = '', updatedAt = 0, lastSnapshot = ''
function refreshHistory() {
  history.value = readGatherHistory(storageKey())
}
function openHistory() {
  if (!current(version) || checking.value || busy.value || !persist()) return
  refreshHistory()
  expandedId.value = ''
  showHistory.value = true
}
function historyEntry(id: string, time: number, data: GatherChatSnapshot): GatherHistoryItem {
  return { id, updatedAt:time, idea:data.sentIdea || data.idea, openingFacts:data.openingFacts || [], exchanges:data.exchanges }
}
function persist() {
  globalThis.clearTimeout(persistTimer)
  if (!current(version) || checking.value) return false
  try {
    if (!idea.value.trim() && !draft.value) {
      if (chatId) { removeGatherHistory(storageKey(), chatId); clearForm() }
      return true
    }
    if (updatedAt && Date.now() - updatedAt >= GATHER_HISTORY_TTL) {
      removeGatherHistory(storageKey(), chatId); clearForm(); return true
    }
    const data = snapshot(), serialized = JSON.stringify(data)
    if (serialized === lastSnapshot) return true
    const now = Date.now()
    if (!chatId) chatId = now.toString(36) + '-' + Math.random().toString(36).slice(2)
    archiveGatherHistory(storageKey(), {...historyEntry(chatId, now, data), snapshot:data})
    updatedAt = now; lastSnapshot = serialized
    return true
  } catch { error.value = '本机保存失败，请保留当前页面'; return false }
}
function resumeHistory(id: string) {
  if (!current(version) || checking.value || busy.value || !persist()) return
  refreshHistory()
  const item = history.value.find(row => row.id === id)
  if (!item?.snapshot) return
  const saved = item.snapshot
  clearForm()
  modelCard.value = saved.modelCardVersion === 1 ? saved.modelCard : null
  idea.value = saved.idea; draft.value = saved.draft; exchanges.value = saved.exchanges
  sentIdea.value = saved.sentIdea || (saved.draft ? saved.idea : '')
  openingFacts.value = saved.openingFacts || []
  reply.value = saved.dockReply === undefined && !saved.custom ? '' : saved.reply || ''
  dockReply.value = saved.dockReply ?? (saved.custom ? '' : saved.reply || '')
  editing.value = saved.editing || null; custom.value = saved.custom || false
  if (saved.modelCardVersion !== 1 && !editing.value && custom.value && reply.value && saved.draft) {
    editing.value = saved.modelCard?.field ?? pendingGatherFields(saved.draft)[0] ?? null
  }
  createdId.value = saved.createdId || ''; uncertainCreate.value = !!saved.uncertainCreate
  chatId = id; updatedAt = item.updatedAt; lastSnapshot = JSON.stringify(snapshot())
  showHistory.value = false
}
watch(snapshot, () => { globalThis.clearTimeout(persistTimer); persistTimer = globalThis.setTimeout(persist, 300) }, {deep:true})
function clearForm() {
  chatId = ''; updatedAt = 0; lastSnapshot = ''
  sentIdea.value = ''; openingFacts.value = []; outgoing.value = null
  modelCard.value = null
  idea.value = ''; dockReply.value = ''; draft.value = null; exchanges.value = []; reply.value = ''; editing.value = null
  custom.value = false; createdId.value = ''; uncertainCreate.value = false; error.value = ''
}
function forget() {
  if (owner && chatId) archiveGatherHistory(storageKey(), historyEntry(chatId, updatedAt, snapshot()))
  clearForm()
}
watch(() => [session.token, session.epoch, session.member?.id], () => {
  if (!owner) return
  showHistory.value = false; history.value = []; expandedId.value = ''
  ++version; owner = ''; busy.value = false; checking.value = true; canInitiate.value = false; clearForm()
}, {flush:'sync'})
function confirm(title: string, content: string, confirmText: string, cancelText: string) {
  return new Promise<boolean|null>(resolve => uni.showModal({title, content, confirmText, cancelText,
    success: choice => resolve(choice.confirm ? true : choice.cancel ? false : null), fail: () => resolve(null)}))
}
async function checkProfile() {
  if (disposed || busy.value) return
  const request = ++version
  checking.value = true
  canInitiate.value = false
  invitedFriend.value = false
  accessError.value = ''
  try {
    const ready = await requireProfile(routes.activityDraft)
    if (disposed || request !== version) return
    if (!ready || !session.member?.id) { accessError.value = '请先完善会员资料'; return }
    const access = await api.communityAccess()
    if (disposed || request !== version) return
    if (!access.isRegistered) { invitedFriend.value = true; return }
    canInitiate.value = true
    if (owner === session.member.id) {
      refreshHistory()
      if (updatedAt && Date.now() - updatedAt >= GATHER_HISTORY_TTL) clearForm()
      return
    }
    owner = session.member.id
    refreshHistory()
    const raw = uni.getStorageSync(storageKey())
    if (!raw) return
    const saved: ReturnType<typeof snapshot> & {chatId?:string; updatedAt?:number} = JSON.parse(raw)
    if (typeof saved.idea !== 'string' || !Array.isArray(saved.exchanges)) return
    // Legacy snapshots have no reliable creation time; give them one bounded recovery window.
    const savedTime = saved.updatedAt ?? Date.now()
    if (!Number.isFinite(savedTime) || Date.now() - savedTime >= GATHER_HISTORY_TTL || savedTime > Date.now()) {
      uni.removeStorageSync(storageKey()); return
    }
    const savedId = saved.chatId || savedTime.toString(36) + '-' + Math.random().toString(36).slice(2)
    // Import the old single active draft once. Opening the page always starts a fresh chat.
    archiveGatherHistory(storageKey(), {...historyEntry(savedId, savedTime, saved), snapshot:saved})
    uni.removeStorageSync(storageKey())
    refreshHistory()
  } catch (e) { if (request === version) { if (canInitiate.value) error.value = errorMessage(e); else accessError.value = errorMessage(e) } }
  finally { if (request === version) checking.value = false }
}
async function generate() {
  if (busy.value || checking.value || disposed || draft.value) return
  const text = idea.value.trim()
  if (!text || text.length > 5000) { error.value = '请输入 1 至 5000 字的聚会想法'; return }
  if (!current(version)) { loginPage(routes.activityDraft); return }
  const request = version
  sentIdea.value = text
  busy.value = true; error.value = ''
  try {
    const result = await api.generateActivityDraft(publicText(text), {known:[], recent:[], pending:['title','description','date','time','location','fee','amount','contact']})
    if (!current(request)) return
    draft.value = createGatherDraft(text, result.draft)
    openingFacts.value = gatherFacts(null, draft.value)
    modelCard.value = usableModelQuestion(result.nextQuestion, draft.value)
    persist()
  } catch (e) { if (current(request)) error.value = errorMessage(e) }
  finally { if (current(request)) busy.value = false }
}
const fieldNames: Record<GatherField,string> = {
  title:'主题', description:'聚会介绍', date:'日期', time:'时间', location:'地点', joining:'地点',
  fee:'费用', amount:'金额', capacity:'人数', contact:'咨询方式'
}
const pending = computed(() => draft.value ? pendingGatherFields(draft.value) : [])
const previewReady = computed(() => !!draft.value && !editing.value && !pending.value.length)
const question = computed<GatherQuestion | null>(() => {
  if (!draft.value) return null
  if (editing.value) return { field:editing.value, prompt:'修改' + fieldNames[editing.value], options:[] }
  return usableModelQuestion(modelCard.value, draft.value)
})
async function requestQuestion() {
  const d = draft.value, request = version
  if (!d || !pending.value.length || busy.value || checking.value || !current(request)) return
  busy.value = true; error.value = ''
  try {
    const result = await api.generateActivityDraft('请根据已确认的聚会安排和表单缺项继续提问。', gatherContext(d, exchanges.value))
    if (!current(request)) return
    modelCard.value = usableModelQuestion(result.nextQuestion, d)
    persist()
  } catch (e) { if (current(request)) error.value = errorMessage(e) }
  finally { if (current(request)) busy.value = false }
}
const starters = ['想约几位同行聊聊 AI 应用', '周末办一场十来人的读书会']
const focused = ref<'dock' | 'card' | null>(null)
const keyboard = ref(0)
const message = computed({
  get: () => busy.value ? '' : draft.value ? dockReply.value : idea.value,
  set: (value: string) => { if (draft.value) dockReply.value = value; else idea.value = value }
})
async function focusComposer(target: 'dock' | 'card') {
  focused.value = null
  await nextTick()
  focused.value = target
}
function blurComposer(target: 'dock' | 'card') {
  if (focused.value === target) focused.value = null
}
function chooseStarter(text: string) {
  idea.value = text
  void focusComposer('dock')
}
function writeAnswer() {
  custom.value = true
  void focusComposer('card')
}
function sendCard() {
  if (!reply.value.trim() || busy.value || checking.value) return
  void answer(reply.value, false, 'card')
  focused.value = null
  uni.hideKeyboard()
}
function sendMessage() {
  const text = message.value.trim()
  if (!text || busy.value || checking.value) return
  if (draft.value) void answer(text)
  else void generate()
  focused.value = null
  uni.hideKeyboard()
}
const questionNames = computed(() => draft.value?.questions.map(q => q.prompt).join('、') || '')
watch(() => [question.value?.prompt, exchanges.value.length, outgoing.value, sentIdea.value, draft.value !== null], async () => {
  await nextTick()
  if (disposed) return
  const latest = exchanges.value.length - 1
  let selector = ''
  if (outgoing.value) selector = '#outgoing'
  else if (!draft.value && sentIdea.value) selector = '#sent-idea'
  else if (draft.value && !question.value) selector = previewReady.value ? '#invite-preview' : '#ask-again'
  else if (!editing.value && latest >= 0 && exchanges.value[latest].facts?.length) selector = '#facts-' + latest
  else if (!editing.value && latest < 0 && openingFacts.value.length) selector = '#opening-facts'
  else if (draft.value) selector = question.value ? '#active-question' : '#invite-preview'
  if (selector) uni.pageScrollTo({selector, duration:180})
})
const options = computed(() => {
  const q = question.value
  if (q?.field === 'location' && !editing.value && !q.options.length) return ['线下聚会']
  if (q?.field === 'contact' && session.member?.boundPhone && /^1\d{10}$/.test(session.member.boundPhone))
    return ['使用我的手机号（尾号 ' + session.member.boundPhone.slice(-4) + '）', ...q.options]
  return q?.options || []
})
const rows = computed(() => {
  const d = draft.value
  if (!d) return []
  return [
    {field:'time', label:'时间', value:d.startsAt && d.endsAt ? activityTimeRangeWeekday(d.startsAt, d.endsAt) : d.date},
    {field:'location',label:'地点', value:d.location},
    {field:'fee',label:'费用',value:d.feeType === 'free' ? '免费' : d.feeType === 'paid' ? '¥' + (Number(d.feeAmountCents) / 100) + ' / 人' : ''},
    {field:'capacity',label:'人数',value:d.capacity ? '限 ' + d.capacity + ' 人' : '不限人数'},
    {field:'contact',label:'咨询',value:d.consultationContact}
  ] as {field:GatherField; label:string; value:string|null}[]
})
function edit(field: GatherField) {
  if (busy.value || createdId.value) return
  outgoing.value = null; editing.value = field; custom.value = true; reply.value = ''; error.value = ''
}
async function answer(value: string, suggested = false, source: 'chat' | 'card' = 'chat') {
  const q = question.value, d = draft.value
  if (!d || busy.value || checking.value || createdId.value || uncertainCreate.value || !current(version)) return
  if (suggested) source = 'card'
  if (source === 'card' && !q) return
  const text = suggested && q?.field === 'contact' && value.startsWith('使用我的手机号')
    ? session.member?.boundPhone || '' : value.trim()
  if (!text) return
  if (q?.field === 'location' && (text === '线下聚会' || (suggested && text.endsWith('（填地址）')))) {
    custom.value = text === '线下聚会' ? 'offline' : text
    void focusComposer('card')
    return
  }
  const freeEdit = source === 'chat'
  const turn = {field:q?.field ?? 'time', prompt:freeEdit ? '补充或修改安排' : q!.prompt, answer:value, freeEdit}
  const local = applyGatherEdit(d, text, q?.field ?? null, source)
  const request = version
  const commit = (next: GatherDraft, card: GatherQuestion | null) => {
    const facts = gatherFacts(d, next)
    const clarification = usableModelQuestion(card, next)
    draft.value = next
    exchanges.value.push({...turn, facts})
    outgoing.value = null
    modelCard.value = clarification
    if (freeEdit) dockReply.value = ''
    if (!freeEdit || question.value?.field !== q?.field) {
      editing.value = null; custom.value = false; reply.value = ''
    }
    error.value = ''
    persist()
  }
  outgoing.value = turn; error.value = ''
  const localContact = local.consultationContact !== d.consultationContact || (q?.field === 'contact' && !freeEdit)
  if (localContact || (suggested && !pendingGatherFields(local).length)) {
    commit(local, null)
    if (localContact && !outgoing.value && pending.value.length) await requestQuestion()
    return
  }
  const target = q?.field || 'time'
  const field = target === 'date' || target === 'contact' ? 'time' : target === 'amount' ? 'fee' : target === 'joining' ? 'location' : target
  const period = d.period === '上午' ? 'morning' : d.period === '下午' ? 'afternoon' : d.period === '晚上' ? 'evening' : undefined
  busy.value = true
  try {
    const result = await api.interpretActivityReply(publicText(text), field, d.date || undefined, period, gatherContext(local, [...exchanges.value, {...turn, prompt:q?.prompt ?? turn.prompt}]))
    if (!current(request)) return
    commit(applyGatherEdit(d, text, q?.field ?? null, source, result.draft), result.nextQuestion ?? null)
  } catch (e) {
    if (!current(request)) return
    modelCard.value = null
    if (JSON.stringify(local) !== JSON.stringify(d) || suggested) commit(local, null)
    error.value = errorMessage(e) + '。已保留你的回答。'
  } finally { if (current(request)) busy.value = false }
}
function moreSettings() {
  const d = draft.value, request = version
  if (!d || busy.value || !current(request) || uncertainCreate.value) return
  if (createdId.value) { navigate(routes.editor + '?id=' + encodeURIComponent(createdId.value)); return }
  persist()
  stageActivityDraft(owner, session.epoch, d, d.consultationContact, () => { if (current(request)) forget() })
  navigate(routes.editor + '?aiDraft=1')
}
function inputForPublish(d: GatherDraft): ActivityWriteInput {
  if (pendingGatherFields(d).length || !d.title || !d.description || !d.location || !d.feeType || !d.startsAt || !d.endsAt || !d.consultationContact)
    throw new Error('请先补齐邀请卡内容')
  if (d.registrationDeadline && (Date.parse(d.registrationDeadline) <= Date.now() || Date.parse(d.registrationDeadline) > Date.parse(d.startsAt)))
    throw new Error('请在更多设置中调整报名截止时间')
  const questions = d.questions.map(q => {
    if (!q.type || q.required === null || (['single','multiple'].includes(q.type) && !q.options?.length))
      throw new Error('请在更多设置中确认报名问题的题型、选项和必填设置')
    return {prompt:q.prompt, type:q.type, required:q.required, options:q.options, publicToParticipants:false}
  })
  return {title:d.title, description:d.description, location:d.location, consultationContact:d.consultationContact,
    startsAt:d.startsAt, endsAt:d.endsAt, feeType:d.feeType, feeAmountCents:d.feeAmountCents,
    capacity:d.capacity, registrationDeadline:d.registrationDeadline, questions}
}
async function publish() {
  if (!draft.value || !previewReady.value || busy.value || !current(version) || uncertainCreate.value) return
  const request = version
  busy.value = true; error.value = ''
  try {
    const input = inputForPublish(draft.value)
    if (!await confirm('发布这场聚会？', '发布后，用户可以查看聚会并报名。', '确认发布', '再看看') || !current(request)) return
    if (!createdId.value) {
      uncertainCreate.value = true; persist()
      try {
        const activity = await api.createActivity(input)
        if (!current(request)) return
        createdId.value = activity.id; uncertainCreate.value = false; persist()
      } catch (e) {
        if (!current(request)) return
        if (e instanceof ApiError && e.status > 0 && e.status < 500) uncertainCreate.value = false
        throw e
      }
    }
    const id = createdId.value
    const record = await api.managedActivity(id)
    if (!current(request)) return
    if (record.lifecycle === 'draft') await api.publishActivity(id)
    else if (record.lifecycle !== 'published') throw new Error('当前活动状态不能发布，请前往我发起的查看')
    if (!current(request)) return
    forget(); navigate(routes.manage + '?id=' + encodeURIComponent(id), true)
  } catch (e) { if (current(request)) { error.value = errorMessage(e); persist() } }
  finally { if (current(request)) busy.value = false }
}
onShow(checkProfile)
onHide(persist)
onUnload(() => { persist(); disposed = true; globalThis.clearTimeout(persistTimer); ++version })
</script>

<template>
  <view class="gather-page">
    <PageReturn />
    <view v-if="!canInitiate" class="conversation">
      <view v-if="checking" class="helper">正在确认社群身份…</view>
      <GatherMembershipNote v-else-if="invitedFriend" @back="returnToAssistant" />
      <view v-else class="error">{{ accessError }} <button class="text-link" @click="checkProfile">重新加载</button></view>
    </view>
    <view v-else-if="showHistory" class="conversation">
      <button class="text-link" @click="showHistory = false">返回对话</button>
      <view class="question-title">近七天聊天记录</view>
      <view v-if="!history.length" class="helper">暂无聊天记录</view>
      <view v-for="item in history" :key="item.id" class="question-card">
        <button class="option" @click="expandedId = expandedId === item.id ? '' : item.id">{{ item.idea }}</button>
        <button v-if="item.snapshot" class="text-link" @click="resumeHistory(item.id)">继续填写</button>
        <view v-if="expandedId === item.id">
          <view v-if="item.openingFacts.length" class="past-prompt">{{ item.openingFacts.join(' · ') }}</view>
          <view v-for="(turn,index) in item.exchanges" :key="index">
            <view class="past-prompt">{{ turn.prompt }}</view><view class="user-bubble">{{ turn.answer }}</view>
            <view v-if="turn.facts?.length" class="past-prompt">{{ turn.facts.join(' · ') }}</view>
          </view>
        </view>
      </view>
    </view>
    <view v-else class="conversation" :style="keyboard ? {paddingBottom:(keyboard + 84) + 'px'} : undefined">
      <view class="assistant-line chat-heading">
        <view class="assistant-mark">✦</view><text>i 助手</text>
        <button class="utility-button history-link" :disabled="busy || checking" @click="openHistory"><view class="clock-icon" />聊天记录</button>
      </view>
      <view v-if="!sentIdea" class="greeting">说说你的聚会想法，i 助手会根据你提供的信息继续提问。</view>
      <view v-if="!sentIdea && !draft && !busy" class="starters">
        <button v-for="starter in starters" :key="starter" class="starter" :disabled="checking" @click="chooseStarter(starter)">{{ starter }} ›</button>
      </view>
      <view v-if="sentIdea" id="sent-idea" class="user-bubble">{{ sentIdea }}</view>
      <view v-if="openingFacts.length" id="opening-facts" class="fact-summary">
        <text class="fact-heading">已记下</text><text v-for="fact in openingFacts" :key="fact" class="fact">{{ fact }}</text>
      </view>
        <view
          v-for="(turn, index) in exchanges"
          :key="index"
          class="past-turn"
        >
          <view class="past-prompt">{{ turn.prompt }}</view>
          <view v-if="turn.freeEdit" class="user-bubble">{{ turn.answer }}</view>
          <button v-else
            class="user-bubble past-answer"
            :disabled="busy"
            @click="edit(turn.field)"
          >
            {{ turn.answer }} <text class="edit-mark">✎</text>
          </button>
          <view v-if="turn.facts?.length" :id="'facts-' + index" class="fact-summary">
            <text class="fact-heading">已记下</text><text v-for="fact in turn.facts" :key="fact" class="fact">{{ fact }}</text>
          </view>
          <view v-if="turn.facts?.length === 0" class="past-prompt">本轮没有更新聚会安排。</view>
        </view>
      <view v-if="outgoing" id="outgoing">
        <view class="past-prompt">{{ outgoing.prompt }}</view>
        <view class="user-bubble">{{ outgoing.answer }}</view>
        <view v-if="error && !busy" class="error" role="alert">{{ error }}</view>
      </view>
      <view v-if="busy && (!previewReady || outgoing)" class="reply-status">i 助手正在回复…</view>
      <view v-if="question && draft && !(outgoing && busy)" class="turns">
        <view v-if="!editing" class="assistant-line"><view class="assistant-mark">✦</view><text>i 助手</text>
          <button v-if="!busy" class="utility-button manual-link" @click="moreSettings">手动填写 <text>›</text></button>
        </view>
        <view
          id="active-question"
          class="question-card"
        >
          <view class="question-title">{{ question.prompt }}</view>
          <button
            v-if="question.field === 'time'"
            class="text-link"
            :disabled="busy"
            @click="edit('date')"
          >
            修改日期
          </button>
          <view
            v-if="question.field === 'contact'"
            class="helper"
          >
            选定的咨询方式将显示在聚会详情中。
          </view>
          <button
            v-for="option in options"
            :key="option"
            class="option"
            :class="{selected:(option === '线下聚会' && custom === 'offline') || option === custom}"
            :disabled="busy"
            @click="answer(option, true)"
          >
            <view class="radio" /><text>{{ option }}</text>
          </button>
          <button
            v-if="!editing"
            class="option custom-option"
            :class="{selected:custom === true}"
            :disabled="busy"
            @click="writeAnswer"
          >
            <view class="radio" /><text>自己填写</text><text class="pencil">✎</text>
          </button>
          <view v-if="custom" class="inline-answer">
            <view class="input-shell">
              <textarea v-model="reply" class="chat-input" :focus="focused === 'card'" auto-height
                :disabled="busy || checking" :maxlength="1000" :cursor-spacing="88" confirm-type="send"
                :placeholder="question.field === 'location' ? '输入场地名称或详细地址' : '填写你的回答'"
                @keyboardheightchange="keyboard = $event.detail.height" @focus="focused = 'card'" @blur="blurComposer('card')" @confirm="reply = $event.detail.value; sendCard()" />
            </view>
            <button class="send" :disabled="busy || checking || !reply.trim()" @tap="sendCard">发送</button>
          </view>
          <button
            v-if="editing"
            class="text-link cancel-edit"
            :disabled="busy"
            @click="editing = null; custom = false; reply = ''; error = ''"
          >
            取消修改
          </button>
        </view>
      </view>
      <view
        v-else-if="previewReady && draft"
        id="invite-preview"
        class="review"
      >
        <view class="assistant-line"><view class="assistant-mark">✦</view><text>i 助手</text></view>
        <view class="ready-text">邀请卡整理好了，看看是否合适。</view>
        <view class="invitation">
          <view class="invite-kicker">聚会邀请</view>
          <button
            class="title-edit"
            :disabled="busy || !!createdId"
            @click="edit('title')"
          >
            <text>{{ draft.title }}</text><text class="edit-mark">✎</text>
          </button>
          <button
            class="description-edit"
            :disabled="busy || !!createdId"
            @click="edit('description')"
          >
            {{ draft.description }}
          </button>
          <view class="info-rows">
            <button
              v-for="row in rows"
              :key="row.field"
              class="info-row"
              :disabled="busy || !!createdId"
              @click="edit(row.field)"
            >
              <text class="info-label">{{ row.label }}</text><text class="info-value">{{ row.value }}</text><text class="chevron">›</text>
            </button>
            <view
              v-if="questionNames"
              class="questions-summary"
            >
              报名问题：{{ questionNames }}
            </view>
          </view>
          <button
            class="more"
            :disabled="busy"
            @click="moreSettings"
          >
            <text>更多设置</text><text class="chevron">›</text>
          </button>
        </view>
        <text
          v-if="draft.feeType === 'paid'"
          class="helper paid-note"
        >
          {{ feeDisclaimer }}
        </text>
      </view>
      <view v-else-if="draft && !question && !previewReady && !busy" id="ask-again" class="retry-panel">
        <text class="helper">已保留你的安排。你可以补充{{ fieldNames[pending[0]] }}，或请 AI 继续提问。</text>
        <view class="retry-actions">
          <button class="utility-button retry-primary" :disabled="checking" @click="requestQuestion">请 AI 继续提问</button>
          <button class="utility-button" :disabled="checking" @click="moreSettings">手动填写 <text>›</text></button>
        </view>
      </view>
      <view
        v-if="error && !outgoing"
        class="error"
        role="alert"
      >
        {{ error }} <button v-if="!owner" class="text-link" @click="checkProfile">重试</button>
      </view>
      <view
        v-if="uncertainCreate && !busy"
        class="error"
      >
        创建结果待核对，请先查看「我发起的」中的活动草稿。<button
          class="text-link"
          @click="navigate(routes.organizedActivities)"
        >
          查看我发起的
        </button>
      </view>
      <button
        v-if="previewReady"
        class="primary publish"
        :disabled="busy || checking || uncertainCreate"
        :loading="busy"
        @click="publish"
      >
        {{ createdId ? '继续发布' : '确认发布' }}
      </button>
    </view>
    <view v-if="canInitiate && !showHistory && !createdId && !uncertainCreate" class="chat-dock" :style="{bottom:keyboard + 'px'}">
      <view v-if="!draft && !busy" class="opening-actions">
        <button class="utility-button manual-link" @click="navigate(routes.editor)">手动填写 <text>›</text></button>
      </view>
      <view class="chat-bar">
        <view class="input-shell">
          <textarea v-model="message" class="chat-input" :disabled="busy || checking" :maxlength="draft ? 1000 : 5000"
            :focus="focused === 'dock'" :adjust-position="false" fixed auto-height confirm-type="send"
            :placeholder="draft ? '补充或修改聚会安排…' : '说说你的聚会想法…'"
            @keyboardheightchange="keyboard = $event.detail.height" @focus="focused = 'dock'" @blur="blurComposer('dock')"
            @confirm="message = $event.detail.value; sendMessage()" />
        </view>
        <button class="send" aria-label="发送" :loading="busy" :disabled="busy || checking || !message.trim()" @tap="sendMessage"><text v-if="!busy">发送</text></button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.gather-page { min-height:100vh; background:#eaf1ed; color:#182c23; }
.conversation { padding:32rpx 28rpx calc(200rpx + env(safe-area-inset-bottom)); }
.assistant-line { display:flex; align-items:center; gap:16rpx; color:#56685f; font-size:25rpx; }
.chat-heading { margin-bottom:16rpx; }
.utility-button { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; gap:10rpx; min-height:72rpx; margin:0; padding:0 24rpx; border:1rpx solid #cadbd1; border-radius:18rpx; background:#fff; color:#265741; font-size:26rpx; font-weight:500; line-height:1.3; }
.utility-button::after { border:0; }
.history-link,.manual-link { margin-left:auto; }
.clock-icon { position:relative; box-sizing:border-box; width:26rpx; height:26rpx; border:2rpx solid currentColor; border-radius:50%; }
.clock-icon::before { content:''; position:absolute; left:9rpx; top:4rpx; width:6rpx; height:7rpx; border-left:2rpx solid currentColor; border-bottom:2rpx solid currentColor; }
.reply-status { margin:16rpx 0; color:#526d5f; font-size:26rpx; }
.retry-panel { padding:24rpx; background:#fff; border-radius:20rpx; }
.retry-actions { display:flex; flex-wrap:wrap; gap:16rpx; margin-top:16rpx; }
.retry-primary { background:#185e44; border-color:#185e44; color:#fff; }
.assistant-mark { display:flex; align-items:center; justify-content:center; width:56rpx; height:56rpx; background:#185e44; color:white; border-radius:14rpx; font-size:36rpx; }
.greeting { margin:-8rpx 12rpx 20rpx 72rpx; background:white; border-radius:4rpx 22rpx 22rpx; padding:20rpx 24rpx; font-size:31rpx; line-height:1.55; }
.starters { margin-left:72rpx; }
.starter { display:table; margin:12rpx 0; padding:12rpx 20rpx; border:1rpx solid #9abaac; background:white; color:#195e45; border-radius:40rpx; font-size:26rpx; line-height:1.5; }
.question-card,.invitation { border-radius:22rpx; background:white; border:1rpx solid #dce4dc; }
.chat-dock { position:fixed; left:0; right:0; z-index:3; }
.opening-actions { display:flex; align-items:center; justify-content:flex-end; padding:8rpx 20rpx 14rpx; }
.chat-bar { display:flex; align-items:flex-end; padding:14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); gap:14rpx; background:#fff; border-top:1rpx solid #dce4dc; }
.input-shell { flex:1; min-width:0; padding:15rpx 20rpx; background:#f9faf9; border:1rpx solid #cbd8cf; border-radius:22rpx; }
.chat-input { display:block; width:100%; min-height:46rpx; max-height:180rpx; padding:0; color:#182c23; font-size:30rpx; line-height:46rpx; }
.primary,.send { color:white; background:#13593c; }
.primary { width:100%; margin-top:27rpx; border-radius:18rpx; font-size:31rpx; font-weight:600; line-height:88rpx; }
.primary[disabled],.send[disabled] { background:#b2c8b9; color:white; }
.text-link { margin:0; padding:12rpx 0; font-size:25rpx; background:transparent; color:#216044; line-height:1.5; }
.user-bubble { display:block; max-width:85%; width:fit-content; margin:0 0 24rpx auto; padding:18rpx 22rpx; background:#dfefdf; border-radius:20rpx 20rpx 4rpx 20rpx; color:#203c2b; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.55; font-size:28rpx; }
.past-prompt { margin:0 0 12rpx; color:#576c5e; font-size:25rpx; }
.past-answer { text-align:left; }
.fact-summary { display:flex; flex-wrap:wrap; align-items:center; gap:10rpx; margin:0 0 22rpx; }
.fact-heading { font-size:25rpx; font-weight:600; color:#245d45; }
.fact { font-size:25rpx; line-height:1.5; padding:5rpx 12rpx; background:#fff; border:1rpx solid #d2e1d7; border-radius:10rpx; overflow-wrap:anywhere; }
.ready-text { font-size:27rpx; line-height:1.5; margin:15rpx 0 20rpx; color:#435a4f; }
.question-card { padding:26rpx; margin-top:16rpx; }
.question-title { font-size:34rpx; line-height:1.45; font-weight:650; margin-bottom:15rpx; }
.helper { font-size:24rpx; line-height:1.55; color:#617068; }
.option,.more,.info-row,.title-edit,.description-edit { display:flex; align-items:center; gap:14rpx; width:100%; text-align:left; background:transparent; border-radius:0; padding:0; }
.option { padding:20rpx 12rpx; min-height:88rpx; font-size:29rpx; line-height:1.5; border-bottom:1rpx solid #e4ebe4; }
.radio { box-sizing:border-box; width:34rpx; height:34rpx; border:2rpx solid #99aa9c; border-radius:50%; flex:none; }
.inline-answer { display:flex; align-items:flex-end; gap:14rpx; margin-top:16rpx; }
.custom-option { border:0; }
.selected { background:#edf5ed; border-radius:10rpx; }
.selected .radio { border:10rpx solid #27744f; }
.pencil,.chevron { margin-left:auto; color:#768c7e; }
.send { display:flex; align-items:center; justify-content:center; min-width:98rpx; height:78rpx; border-radius:39rpx; padding:0 15rpx; font-size:28rpx; line-height:1; flex:none; }
.cancel-edit { margin-left:auto; }
.invitation { padding:32rpx 26rpx 18rpx; border-top:6rpx solid #386345; }
.invite-kicker { font-size:23rpx; color:#596d59; letter-spacing:3rpx; }
.title-edit { font-size:39rpx; line-height:1.4; font-weight:650; margin:12rpx 0; justify-content:space-between; }
.edit-mark { font-size:26rpx; color:#668270; }
.description-edit { font-size:28rpx; line-height:1.6; color:#42564a; white-space:pre-wrap; }
.info-rows { margin-top:22rpx; }
.info-row { padding:16rpx 0; border-bottom:1rpx solid #e7ece6; line-height:1.5; font-size:26rpx; }
.info-label { background:#edf4ec; color:#40604c; padding:2rpx 9rpx; border-radius:5rpx; flex:none; }
.info-value { min-width:0; overflow-wrap:anywhere; }
.more { font-size:27rpx; line-height:1.5; padding:22rpx 2rpx 5rpx; }
.questions-summary,.paid-note { display:block; margin-top:16rpx; font-size:25rpx; line-height:1.5; color:#596d60; }
.error { margin-top:16rpx; background:#fbefea; color:#963b26; border-radius:12rpx; padding:18rpx 20rpx; font-size:25rpx; line-height:1.6; }
</style>
