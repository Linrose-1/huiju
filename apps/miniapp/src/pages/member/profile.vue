<script setup lang="ts">
import PageReturn from '@/components/base/PageReturn.vue'
import { reactive, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { api, refreshMember, errorMessage } from '@/services/api'
import { mediaUrl } from '@/services/api/environment'
import { uploadAvatar } from '@/services/wechat'
import { chooseWechatQr } from '@/services/wechat/member-qr'
import PrivateWechatQr from '@/components/business/PrivateWechatQr.vue'
import { navigate, loginPage, routes } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
const session = useSessionStore()
const emptyForm = () => ({ realName: '', email: '', hometown: '', bio: '', resources: '', needs: '', wechatId: '', personalTag: '', industry: '', hometownCityCode: '', schools: [] as string[] })
const form = reactive(emptyForm()), name = ref(''), loading = ref(false), loaded = ref(false), busy = ref(false), error = ref(''), actionError = ref('')
const wechatQrUrl = ref<string | null>(null), qrVersion = ref(0)
const shortFields = [{ key: 'wechatId', label: '微信号', max: 100 }, { key: 'realName', label: '真实姓名', max: 100 }, { key: 'email', label: '邮箱', max: 320 }] as const
const industries = ['园区运营', '房地产', '教育培训', '信息技术', '金融服务', '商业服务', '制造业', '商贸零售', '文化传媒', '医疗健康', '自行填写']
const customIndustry = ref(false), needsCounty = ref(false), regionParts = ref<string[]>([])
function chooseIndustry(event: { detail: { value: number | string } }) {
  const selected = industries[Number(event.detail.value)]
  if (!selected) return
  customIndustry.value = selected === '自行填写'
  if (!customIndustry.value) form.industry = selected
}
function changeHometown(event: { detail: { value: string[]; code?: string[] } }) {
  const { value, code = [] } = event.detail
  const [province, city, county] = value
  const [provinceCode, cityCode = '', countyCode = ''] = code
  if (!province || !city || !/^\d{6}$/.test(provinceCode || '')) { actionError.value = '请选择完整的家乡城市'; return }
  const municipality = ['110000', '120000', '310000', '500000'].includes(provinceCode)
  const directCounty = /^\d{2}90/.test(cityCode)
  const areaCode = municipality ? provinceCode : directCounty && cityCode.endsWith('00') ? countyCode : cityCode
  regionParts.value = value
  needsCounty.value = directCounty && (!areaCode || areaCode.endsWith('00'))
  if (needsCounty.value) { actionError.value = '请继续选择家乡所在的县市'; return }
  if (!/^\d{6}$/.test(areaCode)) { actionError.value = '请选择完整的家乡城市'; return }
  const label = directCounty && county ? county : city
  form.hometown = municipality || province === label ? province : [province, label].join(' · ')
  form.hometownCityCode = municipality || directCounty ? areaCode : areaCode.slice(0, 4) + '00'
  actionError.value = ''
}
function clearHometown() {
  form.hometown = ''; form.hometownCityCode = ''; regionParts.value = []; needsCounty.value = false
}
const longFields = [{ key: 'bio', label: '个人简介', placeholder: '介绍一下自己' }, { key: 'resources', label: '我有资源', placeholder: '你愿意分享的经验或资源' }, { key: 'needs', label: '我需资源', placeholder: '你希望获得的帮助或合作' }] as const
const keyboardHeight = ref(0)
let keyboardPageVisible = true
function keyboardChanged(event: unknown) {
  if (!keyboardPageVisible) return
  const height = (event as { detail?: { height?: unknown } })?.detail?.height
  keyboardHeight.value = typeof height === 'number' && Number.isFinite(height) ? Math.max(0, height) : 0
}
function openCardSettings() {
  if (fromCard.value) uni.navigateBack()
  else navigate(routes.cardSettings)
}
function resetKeyboard() { keyboardPageVisible = false; keyboardHeight.value = 0 }
let generation = 0
const fromCard = ref(false)
onLoad(options => { fromCard.value = options?.from === 'card' })
async function load() {
  const current = ++generation
  loaded.value = false; error.value = ''; actionError.value = ''
  if (!session.token) { loading.value = false; return }
  loading.value = true
  try {
    const [member, details] = await Promise.all([refreshMember(), api.profileDetails()])
    if (current !== generation) return
    name.value = member?.displayName || ''
    for (const key of ['realName', 'email', 'hometown', 'bio', 'resources', 'needs', 'wechatId', 'personalTag', 'industry', 'hometownCityCode'] as const) form[key] = details[key] || ''
    form.schools = [...(details.schools || [])]
    customIndustry.value = !!form.industry && !industries.includes(form.industry)
    regionParts.value = form.hometownCityCode ? form.hometown.split(' · ') : []
    needsCounty.value = false
    wechatQrUrl.value = details.wechatQrUrl || null
    loaded.value = true
  } catch (e) { if (current === generation) error.value = errorMessage(e) }
  finally { if (current === generation) loading.value = false }
}
async function save() {
  if (busy.value || !loaded.value || !session.token) return
  if (!name.value.trim()) { actionError.value = '请填写用户名称'; return }
  if (needsCounty.value) { actionError.value = '请先选好家乡所在的县市'; return }
  const current = generation, token = session.token, epoch = session.epoch
  const valid = () => current === generation && token === session.token && epoch === session.epoch
  busy.value = true; actionError.value = ''
  let detailsSaved = false
  try {
    const schools = [...new Set(form.schools.map(school => school.trim()).filter(Boolean))]
    await api.saveProfileDetails({ ...form, industry: form.industry.trim(), schools }); detailsSaved = true
    if (!valid()) return
    form.schools = schools
    if (name.value.trim() !== session.member?.displayName || !session.member?.profileComplete) await api.profile(name.value.trim())
    if (valid()) {
      uni.showToast({ title: '资料已保存', icon: 'success' })
      if (fromCard.value) uni.navigateBack()
    }
  } catch (e) { if (valid()) actionError.value = (detailsSaved ? '补充资料已保存，用户名称未保存：' : '') + errorMessage(e) }
  finally { if (valid()) busy.value = false }
}
async function avatar(event: { detail: { avatarUrl?: string } }) {
  if (busy.value || !loaded.value || !event.detail.avatarUrl) return
  const current = generation
  busy.value = true; actionError.value = ''
  try { await uploadAvatar(event.detail.avatarUrl) }
  catch (e) { if (current === generation) actionError.value = errorMessage(e) }
  finally { if (current === generation) busy.value = false }
}
async function changeQr(remove = false) {
  if (busy.value || !loaded.value || !session.token) return
  const current = generation, token = session.token, epoch = session.epoch
  const valid = () => current === generation && token === session.token && epoch === session.epoch
  busy.value = true; actionError.value = ''
  try {
    if (remove) {
      const choice = await uni.showModal({ title: '移除微信二维码', content: '移除后名片不再展示此二维码，是否继续？' })
      if (!choice.confirm || !valid()) return
    }
    const result = remove ? await api.removeWechatQr() : await chooseWechatQr()
    if (result && valid()) { wechatQrUrl.value = result.wechatQrUrl; qrVersion.value++; uni.showToast({ title: remove ? '二维码已移除' : '二维码已保存', icon: 'success' }) }
  } catch (e) { if (valid()) actionError.value = errorMessage(e) }
  finally { if (valid()) busy.value = false }
}
const stop = watch(() => [session.token, session.epoch], () => {
  generation++; loaded.value = false; busy.value = false; name.value = ''; wechatQrUrl.value = null; qrVersion.value++; Object.assign(form, emptyForm()); void load()
}, { flush: 'sync' })
onShow(() => { keyboardPageVisible = true; if (!loaded.value) void load() })
onHide(resetKeyboard)
onUnload(() => { resetKeyboard(); generation++; stop() })
</script>
<template>
  <view class="profile-page">
    <PageReturn />
    <view
      v-if="!session.token"
      class="empty"
    >
      登录后编辑自己的资料<button
        class="text-button"
        @click="loginPage(routes.profile)"
      >
        去登录
      </button>
    </view>
    <template v-else>
      <RequestState
        :loading="loading"
        :error="error"
        @retry="load"
      />
      <template v-if="loaded">
        <view class="panel">
          <view class="section-heading">基本资料</view>
          <view class="form-row avatar-row">
            <text class="label">头像</text><button
              class="avatar-button"
              open-type="chooseAvatar"
              :disabled="busy"
              @chooseavatar="avatar"
            >
              <view class="portrait">
                <image
                  v-if="session.member?.avatarUrl"
                  :src="mediaUrl(session.member.avatarUrl)"
                  mode="aspectFill"
                /><uni-icons
                  v-else
                  type="person-filled"
                  size="60rpx"
                  color="#689380"
                />
              </view><text>更换头像</text><uni-icons
                type="arrow-right"
                size="30rpx"
              />
            </button>
          </view>
          <view class="form-row">
            <text class="label">用户名称</text><input
              v-model="name"
              :disabled="busy"
              class="input"
              type="nickname"
              maxlength="100"
              placeholder="请输入用户名称"
              :adjust-position="true"
              :cursor-spacing="130"
              @focus="keyboardChanged"
              @keyboardheightchange="keyboardChanged"
            >
          </view>
          <view class="form-row phone-row">
            <text class="label">手机号</text><view class="field-content">
              <view
                v-if="session.member?.boundPhone"
                class="phone-value"
              >
                {{ session.member.boundPhone }}<text class="bound">已绑定</text>
              </view><button
                v-else
                class="text-button"
                @click="loginPage(routes.profile)"
              >
                去绑定手机号
              </button><view class="hint">绑定后暂不支持自行修改</view>
            </view>
          </view>
        </view>
        <view class="panel relation-panel">
          <view class="form-row">
            <text class="label">行业</text>
            <picker mode="selector" :range="industries" :value="Math.max(industries.indexOf(form.industry), 0)" :disabled="busy" class="field-picker" @change="chooseIndustry">
              <view class="picker-value">{{ form.industry || '选择行业' }} <text class="picker-arrow">›</text></view>
            </picker>
            <button v-if="form.industry" :disabled="busy" class="remove-field" aria-label="清除行业" @click="form.industry = ''; customIndustry = false">×</button>
          </view>
          <input v-if="customIndustry" v-model="form.industry" class="custom-industry input" :disabled="busy" maxlength="100" placeholder="填写行业名称" :cursor-spacing="130" @focus="keyboardChanged" @keyboardheightchange="keyboardChanged">
          <view class="form-row">
            <text class="label">家乡</text>
            <picker mode="region" :level="needsCounty ? 'region' : 'city'" :value="regionParts" :disabled="busy" class="field-picker" @change="changeHometown">
              <view class="picker-value">{{ needsCounty ? '继续选择县市' : (form.hometown || '选择家乡城市') }} <text class="picker-arrow">›</text></view>
            </picker>
            <button v-if="form.hometown || needsCounty" :disabled="busy" class="remove-field" aria-label="清除家乡" @click="clearHometown">×</button>
          </view>
        </view>
        <view class="panel schools-panel">
          <view class="section-heading">毕业学校</view>
          <view v-for="(_, i) in form.schools" :key="i" class="school-row">
            <input v-model="form.schools[i]" class="school-input" :disabled="busy" maxlength="100" placeholder="填写学校全称" :cursor-spacing="130" @focus="keyboardChanged" @keyboardheightchange="keyboardChanged">
            <button :disabled="busy" class="remove-field" :aria-label="'移除第'+(i+1)+'所学校'" @click="form.schools.splice(i, 1)">×</button>
          </view>
          <button v-if="form.schools.length < 20" class="add-school" :disabled="busy" @click="form.schools.push('')">＋ 添加学校</button>
          <view class="hint">行业、家乡和毕业学校用于匹配学友关系。</view>
        </view>
        <view class="panel">
          <view class="heading-row"><view class="section-heading">补充资料</view><text class="hint">以下资料选填</text></view>
          <view
            v-for="field in shortFields"
            :key="field.key"
            class="form-row optional-row"
          >
            <text class="label">{{ field.label }}</text><input
              v-model="form[field.key]"
              :disabled="busy"
              class="input"
              :maxlength="field.max"
              :placeholder="'请输入'+field.label"
              :adjust-position="true"
              :cursor-spacing="130"
              @focus="keyboardChanged"
              @keyboardheightchange="keyboardChanged"
            >
          </view>
          <view class="form-row optional-row long-row">
            <text class="label">个性标注</text>
            <view class="textarea-wrap">
              <textarea
                v-model="form.personalTag"
                :disabled="busy"
                maxlength="50"
                placeholder="你想说的个性话语"
                :adjust-position="true"
                :cursor-spacing="130"
                @focus="keyboardChanged"
                @keyboardheightchange="keyboardChanged"
              />
              <view class="counter">{{ (form.personalTag || '').length }}/50</view>
            </view>
          </view>
          <view class="qr-section">
            <view class="section-heading">微信二维码</view>
            <view class="hint">选填 PNG/JPG 图片，最大 2 MB。上传或移除后立即保存，默认不公开。</view>
            <PrivateWechatQr
              v-if="wechatQrUrl"
              :key="qrVersion"
              :url="wechatQrUrl"
            />
            <view class="qr-actions">
              <button
                class="text-button"
                :disabled="busy"
                @click="changeQr()"
              >
                {{ wechatQrUrl ? '更换二维码' : '上传二维码' }}
              </button>
              <button
                v-if="wechatQrUrl"
                class="text-button"
                :disabled="busy"
                @click="changeQr(true)"
              >
                移除二维码
              </button>
            </view>
          </view>
          <view
            v-for="field in longFields"
            :key="field.key"
            class="form-row optional-row long-row"
          >
            <text class="label">{{ field.label }}</text><view class="textarea-wrap">
              <textarea
                v-model="form[field.key]"
                :disabled="busy"
                maxlength="2000"
                :placeholder="field.placeholder"
                :adjust-position="true"
                :cursor-spacing="130"
                @focus="keyboardChanged"
                @keyboardheightchange="keyboardChanged"
              /><view class="counter">{{ form[field.key].length }}/2000</view>
            </view>
          </view>
        </view>
        <button
          class="visibility-link"
          :disabled="busy"
          @click="openCardSettings"
        >
          <uni-icons
            type="locked"
            size="38rpx"
            color="#12805b"
          /><text>资料的可见范围由名片展示设置控制</text><uni-icons
            type="arrow-right"
            size="28rpx"
          />
        </button>
        <view
          v-if="actionError"
          class="error"
        >
          {{ actionError }}
        </view>
        <view
          v-if="!keyboardHeight"
          class="footer"
        >
          <button
            class="primary save-button"
            :disabled="busy"
            :loading="busy"
            @click="save"
          >
            保存资料
          </button>
        </view>
        <view
          v-if="keyboardHeight"
          aria-hidden="true"
          :style="{ height: keyboardHeight + 'px' }"
        />
      </template>
    </template>
  </view>
</template>
<style scoped>
.relation-panel .form-row{padding:10rpx 0}.field-picker,.school-input{flex:1;min-width:0}.picker-value{min-height:76rpx;display:flex;justify-content:flex-end;align-items:center;gap:12rpx;font-size:28rpx;color:#244437}.picker-arrow{color:#77867c;font-size:34rpx}.remove-field{display:flex;align-items:center;justify-content:center;width:76rpx;height:76rpx;margin:0;padding:0;color:#758379;font-size:34rpx;background:transparent}.remove-field::after,.add-school::after{border:none}.custom-industry{margin-bottom:12rpx}.school-row{display:flex;align-items:center;gap:12rpx;border-bottom:1rpx solid #e5ebe6}.school-input{height:84rpx;font-size:28rpx}.add-school{margin:8rpx 0;padding:0;min-height:80rpx;line-height:80rpx;text-align:left;color:#155741;background:transparent;font-weight:600;font-size:28rpx}
.qr-section{margin:20rpx 0;padding:20rpx 0;border-top:1rpx solid #edf0ef}.qr-section .hint{margin-bottom:16rpx}.qr-actions{display:flex;gap:24rpx;margin-top:12rpx}.qr-actions button{flex:1;font-size:27rpx}

.profile-page{padding:24rpx 24rpx calc(150rpx + env(safe-area-inset-bottom));background:#f3f8f6;min-height:100vh}.panel{background:#fff;border-radius:22rpx;padding:28rpx 24rpx;margin-bottom:22rpx}.section-heading{font-size:32rpx;font-weight:650;display:flex;align-items:center;gap:14rpx}.section-heading:before{content:'';width:7rpx;height:28rpx;background:#148364;border-radius:5rpx}.heading-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:12rpx}.form-row{display:flex;align-items:center;gap:18rpx;padding:22rpx 0;border-bottom:1rpx solid #edf0ef}.form-row:last-child{border-bottom:0;padding-bottom:4rpx}.label{width:142rpx;flex-shrink:0;font-size:28rpx}.input{flex:1;min-width:0;background:#f3f5f5;height:68rpx;padding:0 18rpx;border-radius:12rpx;font-size:28rpx}.avatar-button{display:flex;align-items:center;gap:12rpx;flex:1;padding:0;background:transparent;font-size:26rpx}.avatar-button text{margin-left:auto}.portrait{height:110rpx;width:110rpx;border-radius:50%;overflow:hidden;background:#eaf3ed;display:flex;align-items:center;justify-content:center}.portrait image{width:100%;height:100%}.field-content{flex:1;min-width:0}.phone-value{font-size:28rpx;display:flex;align-items:center;justify-content:space-between;gap:8rpx}.bound{color:#126e4c;background:#e3f5ea;font-size:22rpx;padding:5rpx 12rpx;border-radius:30rpx}.hint{color:#9099a1;font-size:23rpx;line-height:1.6}.phone-row .hint{margin-top:12rpx}.optional-row{border:0;padding:12rpx 0}.long-row{align-items:flex-start}.long-row .label{padding-top:18rpx}.textarea-wrap{flex:1;min-width:0;background:#f3f5f5;border-radius:12rpx;padding:18rpx}.textarea-wrap textarea{width:100%;height:124rpx;font-size:27rpx;line-height:1.6}.counter{text-align:right;font-size:22rpx;color:#919ba4}.visibility-link{width:100%;display:flex;align-items:center;gap:16rpx;padding:24rpx;background:#fff;border-radius:20rpx;font-size:23rpx;text-align:left}.visibility-link text{flex:1}.footer{position:fixed;left:0;right:0;bottom:0;background:#fff;padding:16rpx 28rpx calc(16rpx + env(safe-area-inset-bottom));z-index:5}.save-button{width:100%;font-size:30rpx;min-height:82rpx;border-radius:20rpx;background:linear-gradient(110deg,#117c62,#43b989)}
</style>
