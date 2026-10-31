<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { api, ApiError, errorMessage } from '@/services/api'
import type { Activity, RegistrationInput } from '@/services/api/types'
import { canEdit, feeNotice, feeDisclaimer } from '@/services/presentation'
import { navigate, routes, requireProfile, loginPage } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import ActivitySummary from '@/components/business/ActivitySummary.vue'
import RequestState from '@/components/base/RequestState.vue'
const id = ref(''), editing = ref(false), activity = ref<Activity | null>(null), phone = ref(''), answers = ref<Record<string, string | string[]>>({}), loading = ref(true), busy = ref(false), error = ref(''), submitError = ref(''), allowed = ref(false)
const recommendationToken = ref('')
const inviteCode = ref(''), verifiedCode = ref(''), inviteError = ref(''), verifying = ref(false)
let generation = 0, verification = 0, alive = true
const session = useSessionStore()
function currentRequest() { const g = generation, token = session.token, epoch = session.epoch; return () => alive && g === generation && token === session.token && epoch === session.epoch }
function removeInvite() { verification++; inviteCode.value = ''; verifiedCode.value = ''; inviteError.value = ''; verifying.value = false }
watch(inviteCode, () => { verification++; verifiedCode.value = ''; inviteError.value = ''; verifying.value = false }, { flush: 'sync' })
watch(() => [session.token, session.epoch], () => { generation++; recommendationToken.value = ''; removeInvite(); initialized = false; answers.value = {}; phone.value = ''; activity.value = null; allowed.value = false; busy.value = false; loading.value = false; submitError.value = ''; error.value = '' }, { flush: 'sync' })
async function verifyInvite() {
    if (busy.value || verifying.value || !allowed.value) return
    inviteCode.value = inviteCode.value.trim().toUpperCase()
    if (!/^[A-Z0-9]{12}$/.test(inviteCode.value)) { inviteError.value = '请输入 12 位免费特邀码'; return }
    const code = inviteCode.value, request = ++verification, current = currentRequest()
    verifying.value = true; inviteError.value = ''
    try { await api.verifySpecialInvite(id.value, code); if (current() && request === verification) verifiedCode.value = code }
    catch (e) { if (current() && request === verification) inviteError.value = errorMessage(e) }
    finally { if (current() && request === verification) verifying.value = false }
}
function returnTarget() { return routes.form + '?id=' + id.value + (editing.value ? '&edit=1' : '') + (recommendationToken.value ? '&recommendationToken=' + encodeURIComponent(recommendationToken.value) : '') }
let initialized = false
let formOwner = ''
const questions = computed(() => activity.value?.questions || [])
async function load() { if (!id.value)
    return; const current = currentRequest(); loading.value = true; error.value = ''; allowed.value = false; try {
    const target = returnTarget()
    if (!await requireProfile(target)) {
        if (!current()) return
        error.value = '请登录并完善资料后继续'
        return
    }
    if (!current()) return
    const detail = await api.activity(id.value)
    if (!current()) return
    activity.value = detail
    if (!editing.value) {
        try {
            const existing = await api.myRegistration(id.value)
            if (!current()) return
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
    if (!current()) return
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
            if (!current()) return
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
        const registration = await api.myRegistration(id.value)
        if (!current()) return
        allowed.value = canEdit(activity.value, registration)
    }
    else {
        allowed.value = activity.value.registrationState === 'open'
    }
}
catch (e) {
    if (current()) error.value = errorMessage(e)
}
finally {
    if (current()) loading.value = false
} }
function selected(id: string, option: string) { const value = answers.value[id]; return Array.isArray(value) ? value.includes(option) : value === option; }
function choose(id: string, option: string, multiple: boolean) { if (busy.value)
    return; if (!multiple) {
    answers.value[id] = option
    return
} const value = answers.value[id]; const list = Array.isArray(value) ? value : []; answers.value[id] = list.includes(option) ? list.filter(item => item !== option) : [...list, option]; }
async function submit() {
    if (busy.value || verifying.value || !activity.value || !allowed.value)
        return
    submitError.value = ''
    if (!editing.value && inviteCode.value.trim() && verifiedCode.value !== inviteCode.value.trim().toUpperCase()) { submitError.value = '请先校验特邀码，或移除后按普通方式报名'; return }
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
    if (!editing.value && recommendationToken.value) payload.recommendationToken = recommendationToken.value
    if (!editing.value && verifiedCode.value) payload.specialInviteCode = verifiedCode.value
    const current = currentRequest()
    busy.value = true
    try {
        if (editing.value)
            await api.editRegistration(id.value, payload.answers)
        else
            await api.register(id.value, payload)
        if (current()) navigate(routes.result + '?id=' + id.value, true)
    }
    catch (e) {
        if (!current()) return
        if (e instanceof ApiError && e.code.startsWith('SPECIAL_INVITE')) verifiedCode.value = ''
        submitError.value = errorMessage(e)
        if (e instanceof ApiError && (e.status === 401 || e.code === 'PROFILE_INCOMPLETE'))
            loginPage(returnTarget())
        else
            await load()
    }
    finally {
        if (current()) busy.value = false
    }
}
onLoad(options => { id.value = String(options?.id || ''); editing.value = options?.edit === '1'; recommendationToken.value = editing.value ? '' : String(options?.recommendationToken || ''); if (!id.value) {
    loading.value = false
    error.value = '报名链接不完整，请从活动详情重新进入'
} })
onShow(load)
onHide(() => { generation++; verification++; verifying.value = false; busy.value = false })
onUnload(() => { alive = false; generation++; verification++ })
</script>
<template>
  <view class="page-pad with-footer">
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    /><template v-if="activity && !loading && !error">
      <ActivitySummary :activity="activity" />
      <view
        v-if="!editing && (activity.feeType==='paid' || inviteCode)"
        class="card"
      >
        <view class="section-title">免费特邀码 <text class="muted small">（选填）</text></view>
        <view class="hint">仅限发起人指定手机号本人使用，请使用您的微信绑定手机号对应的特邀码。</view>
        <input
          v-model="inviteCode"
          class="input"
          maxlength="12"
          placeholder="请输入 12 位特邀码"
          :disabled="busy || !!verifiedCode"
          :cursor-spacing="130"
        >
        <view class="row invite-actions">
          <button
            v-if="!verifiedCode"
            class="secondary"
            :disabled="busy || verifying || !allowed"
            :loading="verifying"
            @click="verifyInvite"
          >
            校验特邀码
          </button><button
            v-if="inviteCode"
            class="text-button"
            :disabled="busy"
            @click="removeInvite"
          >
            移除
          </button>
        </view>
        <view
          v-if="verifiedCode"
          class="notice"
        >
          特邀资格有效，提交报名后生效。报名成功才消耗此码；取消报名后原码不恢复。
        </view>
        <view
          v-if="inviteError"
          class="error"
        >
          {{ inviteError }}
        </view>
      </view>
      <view class="card">
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
            v-if="question.publicToParticipants"
            class="helper"
          >
            报名后对本活动参与者可见
          </view><view
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
                size="24rpx"
              /><text class="option-label">{{ option }}</text>
            </button>
          </view>
        </view><view
          v-if="activity.registrationNotice"
          class="notice form-notice registration-notice"
        >
          <view class="notice-title">报名须知</view><text>{{ activity.registrationNotice }}</text>
        </view><view class="notice form-notice">
          <uni-icons
            type="info-filled"
            size="23"
            color="#e57a28"
          /><view><view class="notice-title">温馨提示</view>提交后，您可在报名截止前修改答案；活动开始前可取消报名。</view>
        </view><view
          v-if="activity.feeType==='paid' && !verifiedCode"
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
          :disabled="busy || verifying || !allowed"
          @click="submit"
        >
          {{ editing?'保存修改':'提交报名' }}
        </button>
      </view>
    </template>
  </view>
</template>
<style scoped>.section-title{margin:0}.field-label{font-size:28rpx}.hint{color:#7e8a95;font-size:24rpx;line-height:1.6;margin-top:12rpx}.input-wrap{position:relative}.input-wrap .input{padding-right:66rpx}.clear-input{position:absolute;right:0;top:0;width:64rpx;height:80rpx;padding:0;background:transparent;display:flex;align-items:center;justify-content:center}.clear-input[disabled]{background:transparent}.long-answer{position:relative}.long-answer textarea{padding-bottom:44rpx;height:200rpx}.word-count{position:absolute;right:18rpx;bottom:12rpx;color:#7e8a95;font-size:23rpx;pointer-events:none}.options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12rpx}.options.single{grid-template-columns:repeat(4,minmax(0,1fr))}.option{display:flex;align-items:center;justify-content:center;gap:6rpx;font-size:24rpx;background:#f3f5f5;color:#203039;border-radius:12rpx;padding:14rpx 8rpx;min-width:0;width:100%;overflow-wrap:anywhere;border:1rpx solid transparent;min-height:57rpx}.option-label{min-width:0}.option.chosen{background:#edf5ef;border-color:#397e62;color:#16634b}.form-notice{margin-top:24rpx;display:flex;align-items:flex-start;gap:14rpx}.notice-title{font-size:27rpx;font-weight:600;margin-bottom:6rpx}.capacity{font-size:23rpx;color:#435466;max-width:42%}.capacity>text:first-child{color:#127957;font-weight:600;font-size:30rpx}.fixed-footer .primary{font-size:29rpx}.registration-notice{display:block;white-space:pre-wrap;overflow-wrap:anywhere}
</style>
