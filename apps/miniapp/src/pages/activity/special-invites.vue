<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { ManagedActivity, SpecialInviteCode } from '@/services/api/types'
import { requireProfile, routes, navigate } from '@/services/navigation'
import { dateTime } from '@/services/presentation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
import ListMore from '@/components/base/ListMore.vue'
const session = useSessionStore()
const id = ref(''), activity = ref<ManagedActivity | null>(null), phone = ref(''), filter = ref('all')
const items = ref<SpecialInviteCode[]>([]), total = ref(0), hasMore = ref(false)
const loading = ref(false), listLoading = ref(false), busy = ref(false), error = ref(''), listError = ref(''), moreError = ref(''), actionError = ref('')
const created = ref<SpecialInviteCode | null>(null)
const filters = [{ value: 'all', label: '全部' }, { value: 'unused', label: '未使用' }, { value: 'used', label: '已使用' }, { value: 'expired', label: '已失效' }, { value: 'paused', label: '已暂停' }]
const labels: Record<string, string> = { unused: '未使用', used: '已使用', expired: '已失效', paused: '已暂停' }
let generation = 0, listGeneration = 0, offset = 0, alive = true, shown = false
const canCreate = computed(() => activity.value?.feeType === 'paid' && activity.value.lifecycle === 'published' && activity.value.moderation === 'normal' && activity.value.registrationState === 'open')
function currentRequest() { const g = generation, token = session.token, epoch = session.epoch; return () => alive && shown && g === generation && token === session.token && epoch === session.epoch }
function clear() { generation++; listGeneration++; activity.value = null; items.value = []; total.value = 0; offset = 0; hasMore.value = false; loading.value = false; listLoading.value = false; busy.value = false; error.value = ''; listError.value = ''; moreError.value = ''; actionError.value = ''; created.value = null }
async function load() {
  if (busy.value) return
  clear(); loading.value = true
  const request = generation
  try {
    if (!id.value) throw new Error('活动链接不完整，请从活动管理重新进入')
    const ready = await requireProfile(routes.specialInvites + '?id=' + encodeURIComponent(id.value))
    if (!alive || !shown || request !== generation) return
    if (!ready) { error.value = '请完善资料后管理活动特邀码'; return }
    const current = currentRequest()
    const result = await api.managedActivity(id.value)
    if (!current()) return
    activity.value = result
    await loadList()
  } catch (e) { if (alive && shown && request === generation) error.value = errorMessage(e) }
  finally { if (request === generation) { loading.value = false; uni.stopPullDownRefresh() } }
}
async function loadList(more = false) {
  if (!activity.value || (more && (listLoading.value || !hasMore.value || moreError.value || listError.value))) return
  if (!more) { listGeneration++; offset = 0; items.value = []; hasMore.value = false; listError.value = ''; moreError.value = '' }
  const current = currentRequest(), request = listGeneration, status = filter.value
  listLoading.value = true
  try {
    const result = await api.specialInviteCodes(id.value, { status, offset })
    if (!current() || request !== listGeneration) return
    offset += result.items.length
    const known = new Set(items.value.map(item => item.id))
    items.value.push(...result.items.filter(item => !known.has(item.id)))
    total.value = result.total; hasMore.value = result.hasMore
  } catch (e) { if (current() && request === listGeneration) { if (more) moreError.value = errorMessage(e); else listError.value = errorMessage(e) } }
  finally { if (current() && request === listGeneration) listLoading.value = false }
}
function selectFilter(value: string) { if (busy.value || value === filter.value) return; filter.value = value; void loadList() }
function retryMore() { moreError.value = ''; void loadList(true) }
async function create() {
  if (busy.value || !canCreate.value) return
  const value = phone.value.trim()
  if (!/^1\d{10}$/.test(value)) { actionError.value = '请填写受邀人微信绑定的 11 位手机号'; return }
  const current = currentRequest(); busy.value = true; actionError.value = ''
  try {
    const result = await api.createSpecialInvite(id.value, value)
    if (!current()) return
    created.value = result; phone.value = ''; filter.value = 'all'
    await loadList()
  } catch (e) { if (current()) actionError.value = errorMessage(e) }
  finally { if (current()) busy.value = false }
}
function copy(item: SpecialInviteCode) {
  if (!activity.value || item.status !== 'unused') return
  const data = `邀请你参加「${activity.value.title}」\n免费特邀码：${item.code}\n仅限本活动及指定手机号本人使用。报名成功后获得本次活动免费参加资格；取消报名后原码不恢复。如需再次特邀，请联系发起人。`
  uni.setClipboardData({ data, fail: () => { actionError.value = '复制未完成，请重试' } })
}
const stop = watch(() => [session.token, session.epoch], () => { phone.value = ''; clear() }, { flush: 'sync' })
onLoad(options => { id.value = String(options?.id || '') })
onShow(() => { shown = true; void load() })
onHide(() => { shown = false; clear() })
onUnload(() => { alive = false; shown = false; clear(); stop() })
onReachBottom(() => loadList(true))
onPullDownRefresh(() => { if (busy.value) uni.stopPullDownRefresh(); else void load() })
</script>
<template>
  <view class="page-pad special-invites">
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    />
    <template v-if="activity && !loading && !error">
      <view class="card"><text class="muted small">当前活动</text><view class="section-title">{{ activity.title }}</view><text class="muted small">{{ dateTime(activity.startsAt) }}</text></view>
      <view
        v-if="canCreate"
        class="card"
      >
        <view class="section-title">发放免费特邀码</view><label class="field-label">受邀人手机号</label>
        <input
          v-model="phone"
          class="input"
          type="number"
          maxlength="11"
          placeholder="请输入受邀人微信绑定的手机号"
          :disabled="busy"
          :cursor-spacing="130"
        >
        <view class="small muted invite-hint">一人一码，仅限此号码对应本人使用。同一号码已有有效码时将返回原码。</view>
        <button
          class="primary create-button"
          :disabled="busy"
          :loading="busy"
          @click="create"
        >
          生成特邀码
        </button>
      </view>
      <view
        v-else
        class="notice"
      >
        当前不能发码。只有已发布、正常展示且可报名的收费活动可以发放；历史记录仍可查看。
      </view>
      <view
        v-if="actionError"
        class="error"
      >
        {{ actionError }}
      </view>
      <view
        v-if="created"
        class="card created-code"
      >
        <view class="row between"><text>特邀码已准备好</text><text class="tag">{{ created.maskedPhone }}</text></view><view class="invite-code">{{ created.code }}</view><button
          class="secondary"
          @click="copy(created)"
        >
          复制邀请说明
        </button>
      </view>
      <scroll-view
        scroll-x
        class="invite-tabs"
      >
        <view class="invite-tabs-inner">
          <button
            v-for="tab in filters"
            :key="tab.value"
            class="invite-tab"
            :class="{selected:filter===tab.value}"
            :disabled="busy"
            @click="selectFilter(tab.value)"
          >
            {{ tab.label }}
          </button>
        </view>
      </scroll-view>
      <view class="small muted count-note">共 {{ total }} 条</view>
      <RequestState
        :loading="listLoading && !items.length"
        :error="listError"
        @retry="loadList()"
      />
      <view
        v-if="!listLoading && !listError && !items.length"
        class="empty"
      >
        {{ filter==='all'?'还没有发放特邀码':'暂无此状态的特邀码' }}
      </view>
      <view
        v-for="item in items"
        :key="item.id"
        class="card"
      >
        <view class="row between">
          <text>{{ item.maskedPhone }}</text><text
            class="tag"
            :class="{inactive:item.status!=='unused'}"
          >
            {{ labels[item.status] }}
          </text>
        </view>
        <view class="invite-code">{{ item.code }}</view>
        <view class="small muted">生成于 {{ dateTime(item.createdAt) }}</view>
        <view class="small muted">有效截止 {{ dateTime(item.expiresAt) }}</view>
        <button
          v-if="item.status==='unused'"
          class="text-button"
          @click="copy(item)"
        >
          复制邀请说明
        </button>
        <button
          v-if="item.status==='used' && item.registrationId"
          class="text-button"
          @click="navigate(routes.manage+'?id='+id+'&registrationId='+encodeURIComponent(item.registrationId))"
        >
          查看报名记录
        </button>
        <view
          v-if="item.status==='paused'"
          class="small muted invite-hint"
        >
          当前暂停使用，恢复可报名条件且仍在有效期内后可恢复。
        </view>
      </view>
      <ListMore
        :loading="listLoading && items.length > 0"
        :has-items="items.length > 0"
        :has-more="hasMore"
        :error="moreError"
        @retry="retryMore"
      />
      <view class="notice">报名成功才消耗特邀码；取消报名不会恢复原码。此码不改变双方的学友邀请关系。</view>
    </template>
  </view>
</template>
<style scoped>
.special-invites{padding-bottom:calc(40rpx + env(safe-area-inset-bottom))}.invite-hint{line-height:1.7;margin:14rpx 0}.create-button{margin-top:20rpx;width:100%}.invite-code{font-size:36rpx;letter-spacing:3rpx;font-weight:600;color:#18583e;margin:20rpx 0;overflow-wrap:anywhere}.created-code{border:1rpx solid #b9d9c7;margin-top:20rpx}.invite-tabs{width:100%;margin-top:24rpx}.invite-tabs-inner{display:flex;gap:8rpx;white-space:nowrap}.invite-tab{background:transparent;color:#6d8075;padding:16rpx 20rpx;border-radius:0;font-size:26rpx;flex-shrink:0;border-bottom:4rpx solid transparent}.invite-tab.selected{color:#17583e;border-bottom-color:#17583e;font-weight:600}.count-note{padding:12rpx 0}.inactive{background:#eef1ef;color:#728078}
</style>
