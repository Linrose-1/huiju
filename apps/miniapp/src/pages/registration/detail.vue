<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { api, ApiError, errorMessage } from '@/services/api'
import type { Activity, Registration } from '@/services/api/types'
import { canEdit, canCancel, dateTime, feeDisclaimer, registrationStatus } from '@/services/presentation'
import { navigate, routes, loginPage } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import ActivitySummary from '@/components/business/ActivitySummary.vue'
import RequestState from '@/components/base/RequestState.vue'
const id = ref(''), activity = ref<Activity | null>(null), registration = ref<Registration | null>(null), loading = ref(true), error = ref(''), busy = ref(false), actionError = ref('')
const editable = computed(() => !!activity.value && !!registration.value && canEdit(activity.value, registration.value))
const cancellable = computed(() => !!activity.value && !!registration.value && canCancel(activity.value, registration.value))
const session = useSessionStore()
const status = computed(() => activity.value && registration.value ? registrationStatus(activity.value, registration.value) : null)
async function load() { if (!id.value)
    return; if (!session.token) {
    loading.value = false
    error.value = '请登录后查看本人的报名'
    return
} loading.value = true; error.value = ''; try {
    [activity.value, registration.value] = await Promise.all([api.activity(id.value), api.myRegistration(id.value)])
}
catch (e) {
    error.value = errorMessage(e)
}
finally {
    loading.value = false
} }
function edit() { navigate(routes.form + '?id=' + id.value + '&edit=1'); }
function answer(questionId: string) { const value = registration.value?.answers.find(item => item.questionId === questionId)?.value; return Array.isArray(value) ? value.join('、') : value || '未填写'; }
async function cancel() {
    if (busy.value || !cancellable.value)
        return
    busy.value = true
    actionError.value = ''
    try {
        const result = await uni.showModal({ title: '取消报名', content: '取消后将释放名额，再次报名需要重新竞争名额。' + (activity.value?.feeType === 'paid' ? feeDisclaimer + '。' : ''), confirmText: '确认取消', confirmColor: '#9a4d33' })
        if (!result.confirm)
            return
        await api.cancel(id.value)
        await load()
    }
    catch (e) {
        actionError.value = errorMessage(e)
        if (e instanceof ApiError && e.status === 401)
            loginPage(routes.result + '?id=' + id.value)
    }
    finally {
        busy.value = false
    }
}
function copyContact() { if (activity.value?.consultationContact)
    uni.setClipboardData({ data: activity.value.consultationContact }); }
onLoad(options => { id.value = String(options?.id || ''); if (!id.value) {
    loading.value = false
    error.value = '报名链接不完整'
} })
onShow(load)
</script>
<template>
  <view class="page-pad with-footer">
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    /><button
      v-if="!session.token"
      class="primary"
      @click="loginPage(routes.result+'?id='+id)"
    >
      微信登录
    </button><template v-if="activity && registration && !loading && !error">
      <ActivitySummary
        :activity="activity"
        show-organizer
        :registration-label="registration.status==='active'?'已报名':'已取消'"
      /><view class="card">
        <view class="section-title">报名状态</view><view
          v-if="status"
          class="row status"
          :class="status.tone"
        >
          <view class="status-icon">
            <uni-icons
              :type="status.icon"
              size="34"
              :color="status.color"
            />
          </view><view class="status-copy"><view class="status-title">{{ status.title }}</view><view class="muted small">{{ status.description }}</view></view>
        </view><view class="registered-at">
          <view
            class="icon-placeholder"
            style="width:19px;height:19px"
          /> 报名时间 {{ dateTime(registration.currentRegisteredAt) }}
        </view>
      </view>
      <view class="card">
        <view class="row between">
          <view class="section-title">我的报名信息</view><button
            v-if="editable"
            class="text-button"
            @click="edit"
          >
            编辑 / 修改 <uni-icons
              type="arrow-right"
              size="17"
              color="#286f52"
            />
          </button>
        </view><view class="answer-row"><text class="answer-label">用户名称</text><text>{{ session.member?.displayName || '会聚会员' }}</text></view><view class="answer-row"><text class="answer-label">手机号</text><text>{{ registration.contactPhone }}</text></view><view
          v-for="question in activity.questions"
          :key="question.id"
          class="answer-row"
        >
          <text class="answer-label">{{ question.prompt }}</text><text>{{ answer(question.id) }}</text>
        </view>
      </view>
      <view class="card">
        <view class="section-title">活动咨询方式</view><text class="muted small">如有任何问题，请联系活动发起人</text><view class="contact">{{ activity.consultationContact || '暂时无法取得咨询方式，请重试' }}</view><button
          v-if="activity.consultationContact"
          class="text-button"
          @click="copyContact"
        >
          复制咨询方式
        </button>
      </view><view class="card"><view class="section-title">操作说明</view><view class="notice">1. 报名截止前可修改答案，活动取消或下架时不可修改。<br>2. 活动开始前可取消报名，取消后释放名额。<br>3. {{ feeDisclaimer }}。</view></view><view
        v-if="actionError"
        class="error"
      >
        {{ actionError }}
      </view>
      <view class="fixed-footer">
        <button
          v-if="registration.status==='active'"
          class="secondary"
          :disabled="busy || !cancellable"
          :loading="busy"
          @click="cancel"
        >
          取消报名
        </button><button
          v-if="registration.status==='active'"
          class="primary"
          :disabled="busy || !editable"
          @click="edit"
        >
          {{ editable?'修改报名信息':'答案已锁定' }}
        </button><button
          v-else
          class="primary"
          @click="navigate(routes.detail+'?id='+id)"
        >
          返回活动详情
        </button>
      </view>
    </template>
  </view>
</template>
<style scoped>.status{gap:22rpx}.status-copy{flex:1;min-width:0;line-height:1.6}.status-icon{flex-shrink:0}.status.warning .status-icon{background:#fff3dc}.status.warning .status-title{color:#b77925}.status.muted .status-icon{background:#eef1ef}.status.muted .status-title{color:#74817c}.status-icon{width:66rpx;height:66rpx;background:#d8f5e5;border-radius:50%;display:flex;align-items:center;justify-content:center}.status-title{color:#17815d;font-size:31rpx;font-weight:600;margin-bottom:8rpx}.registered-at{border-top:1rpx solid #e1e8e4;margin-top:20rpx;padding-top:17rpx;font-size:25rpx;display:flex;align-items:center;gap:12rpx}.answer-row{display:grid;grid-template-columns:220rpx 1fr;gap:20rpx;font-size:26rpx;line-height:1.65;margin:14rpx 0;overflow-wrap:anywhere}.answer-label{color:#7a939e}.contact{font-size:27rpx;line-height:1.65;white-space:pre-wrap;margin-top:22rpx;overflow-wrap:anywhere}.row .section-title{margin-bottom:0}.card>.row.between{margin-bottom:20rpx}</style>
