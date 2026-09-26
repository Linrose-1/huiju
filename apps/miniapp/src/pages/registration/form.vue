<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { api, ApiError, errorMessage } from '@/services/api'
import type { Activity, RegistrationInput } from '@/services/api/types'
import { canEdit, feeNotice, feeDisclaimer } from '@/services/presentation'
import { navigate, routes, requireProfile, loginPage } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import ActivitySummary from '@/components/business/ActivitySummary.vue'
import RequestState from '@/components/base/RequestState.vue'
const id = ref(''), editing = ref(false), activity = ref<Activity | null>(null), phone = ref(''), answers = ref<Record<string, string | string[]>>({}), loading = ref(true), busy = ref(false), error = ref(''), submitError = ref(''), allowed = ref(false)
let initialized = false
let formOwner = ''
const questions = computed(() => activity.value?.questions || [])
async function load() { if (!id.value)
    return; loading.value = true; error.value = ''; allowed.value = false; try {
    const target = routes.form + '?id=' + id.value + (editing.value ? '&edit=1' : '')
    if (!await requireProfile(target)) {
        error.value = '请登录并完善资料后继续'
        return
    }
    activity.value = await api.activity(id.value)
    if (!editing.value) {
        try {
            const existing = await api.myRegistration(id.value)
            if (existing.status === 'active') {
                navigate(routes.result + '?id=' + id.value, true)
                return
            }
        }
        catch (e) {
            if (!(e instanceof ApiError && e.status === 404))
                throw e
        }
    }
    const currentOwner = useSessionStore().member?.id || ''
    if (formOwner !== currentOwner) {
        initialized = false
        answers.value = {}
        formOwner = currentOwner
    }
    if (!initialized) {
        phone.value = useSessionStore().member?.boundPhone || ''
        for (const question of questions.value)
            answers.value[question.id] = question.type === 'multiple' ? [] : ''
        if (editing.value) {
            const registration = await api.myRegistration(id.value)
            phone.value = registration.contactPhone
            for (const answer of registration.answers)
                answers.value[answer.questionId] = answer.value
            allowed.value = canEdit(activity.value, registration)
        }
        else {
            allowed.value = activity.value.registrationState === 'open'
        }
        initialized = true
    }
    else if (editing.value) {
        allowed.value = canEdit(activity.value, await api.myRegistration(id.value))
    }
    else {
        allowed.value = activity.value.registrationState === 'open'
    }
}
catch (e) {
    error.value = errorMessage(e)
}
finally {
    loading.value = false
} }
function selected(id: string, option: string) { const value = answers.value[id]; return Array.isArray(value) ? value.includes(option) : value === option; }
function choose(id: string, option: string, multiple: boolean) { if (busy.value)
    return; if (!multiple) {
    answers.value[id] = option
    return
} const value = answers.value[id]; const list = Array.isArray(value) ? value : []; answers.value[id] = list.includes(option) ? list.filter(item => item !== option) : [...list, option]; }
async function submit() {
    if (busy.value || !activity.value || !allowed.value)
        return
    submitError.value = ''
    if (!/^\+?[0-9]{6,20}$/.test(phone.value.trim())) {
        submitError.value = '请填写有效的本次联系手机号'
        return
    }
    for (const question of questions.value) {
        const value = answers.value[question.id]
        if (question.required && (!value || (Array.isArray(value) ? value.length === 0 : !value.trim()))) {
            submitError.value = '请填写：' + question.prompt
            return
        }
    }
    const payload: RegistrationInput = { contactPhone: phone.value.trim(), answers: questions.value.map(question => ({ questionId: question.id, value: answers.value[question.id] || (question.type === 'multiple' ? [] : '') })) }
    busy.value = true
    try {
        if (editing.value)
            await api.editRegistration(id.value, payload.answers)
        else
            await api.register(id.value, payload)
        navigate(routes.result + '?id=' + id.value, true)
    }
    catch (e) {
        submitError.value = errorMessage(e)
        if (e instanceof ApiError && (e.status === 401 || e.code === 'PROFILE_INCOMPLETE'))
            loginPage(routes.form + '?id=' + id.value + (editing.value ? '&edit=1' : ''))
        else
            await load()
    }
    finally {
        busy.value = false
    }
}
onLoad(options => { id.value = String(options?.id || ''); editing.value = options?.edit === '1'; if (!id.value) {
    loading.value = false
    error.value = '报名链接不完整，请从活动详情重新进入'
} })
onShow(load)
</script>
<template>
  <view class="page-pad with-footer">
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    /><template v-if="activity && !loading && !error">
      <ActivitySummary :activity="activity" /><view class="card">
        <view class="row between"><view class="section-title">联系信息</view><text class="muted small">用于活动联系</text></view><label class="field-label"><text class="required">*</text>本次联系手机号</label><view class="input-wrap">
          <input
            v-model="phone"
            class="input"
            type="number"
            maxlength="20"
            :disabled="editing || busy"
            :cursor-spacing="130"
          ><button
            v-if="phone && !editing"
            class="clear-input"
            :disabled="busy"
            aria-label="清除联系手机号"
            @click="phone=''"
          >
            <uni-icons
              type="clear"
              size="18"
              color="#b5bdc4"
            />
          </button>
        </view><view class="hint">{{ editing?'已提交的联系手机号保留，本次仅修改报名答案。':'仅用于本次活动联系，不会修改您的绑定手机号。' }}</view>
      </view>
      <view class="card">
        <view class="row between"><view class="section-title">报名问题</view><text class="muted small">带 <text class="required">*</text> 为必填项</text></view><view
          v-if="!questions.length"
          class="muted small"
        >
          本活动无需填写额外问题
        </view><view
          v-for="question in questions"
          :key="question.id"
        >
          <label class="field-label"><text
            v-if="question.required"
            class="required"
          >*</text>{{ question.prompt }}<text v-if="question.type==='single'">（单选）</text><text v-if="question.type==='multiple'">（多选）</text></label><view
            v-if="question.type==='short_text'"
            class="input-wrap"
          >
            <input
              v-model="answers[question.id]"
              class="input"
              :maxlength="500"
              :disabled="busy"
              placeholder="请输入"
              :cursor-spacing="130"
            ><button
              v-if="answers[question.id]"
              class="clear-input"
              :disabled="busy"
              aria-label="清除本题答案"
              @click="answers[question.id]=''"
            >
              <uni-icons
                type="clear"
                size="18"
                color="#b5bdc4"
              />
            </button>
          </view><view
            v-else-if="question.type==='long_text'"
            class="long-answer"
          >
            <textarea
              v-model="answers[question.id]"
              class="input"
              :maxlength="5000"
              :disabled="busy"
              placeholder="请输入"
              :cursor-spacing="130"
            /><view class="word-count">{{ String(answers[question.id] || '').length }}/5000</view>
          </view><view
            v-else
            class="options"
            :class="{single:question.type==='single'}"
          >
            <button
              v-for="option in question.options || []"
              :key="option"
              class="option"
              :class="{chosen:selected(question.id,option)}"
              :disabled="busy"
              @click="choose(question.id,option,question.type==='multiple')"
            >
              <uni-icons
                v-if="selected(question.id,option)"
                type="checkbox-filled"
                color="#217458"
                size="18"
              /> {{ option }}
            </button>
          </view>
        </view><view class="notice form-notice">
          <uni-icons
            type="info-filled"
            size="23"
            color="#e57a28"
          /><view><view class="notice-title">温馨提示</view>提交后，您可在报名截止前修改答案；活动开始前可取消报名。</view>
        </view><view
          v-if="activity.feeType==='paid'"
          class="notice form-notice"
        >
          {{ feeNotice }}。{{ feeDisclaimer }}。
        </view>
      </view>
      <view
        v-if="!allowed"
        class="notice"
      >
        当前状态不允许{{ editing?'修改答案':'报名' }}，请返回活动详情查看最新状态。
      </view><view
        v-if="submitError"
        class="error"
      >
        {{ submitError }}
      </view><view class="fixed-footer">
        <view class="capacity">已报名 <text>{{ activity.activeRegistrationCount }}</text><text v-if="activity.capacity"> / 限额 {{ activity.capacity }}</text></view><button
          class="primary"
          :loading="busy"
          :disabled="busy || !allowed"
          @click="submit"
        >
          {{ editing?'保存修改':'提交报名' }}
        </button>
      </view>
    </template>
  </view>
</template>
<style scoped>.section-title{margin:0}.field-label{font-size:28rpx}.hint{color:#7e8a95;font-size:24rpx;line-height:1.6;margin-top:12rpx}.input-wrap{position:relative}.input-wrap .input{padding-right:66rpx}.clear-input{position:absolute;right:0;top:0;width:64rpx;height:80rpx;padding:0;background:transparent;display:flex;align-items:center;justify-content:center}.clear-input[disabled]{background:transparent}.long-answer{position:relative}.long-answer textarea{padding-bottom:44rpx;height:200rpx}.word-count{position:absolute;right:18rpx;bottom:12rpx;color:#7e8a95;font-size:23rpx;pointer-events:none}.options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12rpx}.options.single{grid-template-columns:repeat(4,minmax(0,1fr))}.option{font-size:25rpx;background:#f3f5f5;color:#203039;border-radius:12rpx;padding:14rpx 8rpx;min-width:0;width:100%;overflow-wrap:anywhere;border:1rpx solid transparent;min-height:57rpx}.option.chosen{background:#edf5ef;border-color:#397e62;color:#16634b}.form-notice{margin-top:24rpx;display:flex;align-items:flex-start;gap:14rpx}.notice-title{font-size:27rpx;font-weight:600;margin-bottom:6rpx}.capacity{font-size:23rpx;color:#435466;max-width:42%}.capacity>text:first-child{color:#127957;font-weight:600;font-size:30rpx}.fixed-footer .primary{font-size:29rpx}</style>
