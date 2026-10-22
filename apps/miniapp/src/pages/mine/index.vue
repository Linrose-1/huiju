<script setup lang="ts">
import { ref, watch } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { useSessionStore } from '@/stores/session'
import { api, errorMessage } from '@/services/api'
import { mediaUrl, LOCAL_TEST } from '@/services/api/environment'
import { navigate, routes, loginPage, requireProfile } from '@/services/navigation'
import { bootstrapIdentity, switchLocalTestActor, getLocalTestActor, localTestActors } from '@/services/wechat'
const session = useSessionStore(), count = ref<number | null>(null), organizedCount = ref<number | null>(null), error = ref(''), loading = ref(false)
const unreadCount = ref(0)
const canEditContent = ref(false)
const switching = ref(false), testActorLabel = ref(LOCAL_TEST ? getLocalTestActor().label : '')
let active = false
let generation = 0
async function chooseTestActor() {
  if (!LOCAL_TEST || switching.value || !active) return
  switching.value = true
  try {
    // 微信操作菜单最多六项；第六项展开其余两种测试身份。
    const first = await uni.showActionSheet({ itemList: [...localTestActors.slice(0, 5).map(actor => actor.label), '更多测试身份…'] })
    if (!active) return
    let index = first.tapIndex
    if (index === 5) {
      const next = await uni.showActionSheet({ itemList: localTestActors.slice(5).map(actor => actor.label) })
      if (!active) return
      index = next.tapIndex + 5
    }
    const actor = localTestActors[index]
    if (!actor) return
    generation++
    error.value = ''
    testActorLabel.value = actor.label
    await switchLocalTestActor(actor.key)
    if (active) await load()
  } catch (e) {
    if (active && !(typeof (e as { errMsg?: unknown })?.errMsg === 'string' && (e as { errMsg: string }).errMsg.includes('cancel'))) error.value = errorMessage(e)
  } finally { switching.value = false }
}
async function load() {
  const current = ++generation
  let token = session.token, epoch = session.epoch
  const isCurrent = () => current === generation && token === session.token && epoch === session.epoch
  count.value = null; organizedCount.value = null; unreadCount.value = 0; error.value = ''; loading.value = false
  canEditContent.value = false
  loading.value = true
  try {
    await bootstrapIdentity()
    if (current !== generation) return
    token = session.token; epoch = session.epoch
    if (!session.member?.profileComplete) return
    void Promise.resolve().then(() => api.platformContent()).then(content => { if (isCurrent()) canEditContent.value = content.canEdit }).catch(() => undefined)
    const [registered, organized, notifications] = await Promise.all([api.registrations(), api.organizedActivities(), api.notifications()])
    if (!isCurrent()) return
    count.value = registered.activeCount
    organizedCount.value = organized.total
    unreadCount.value = notifications.unreadCount
  } catch (e) { if (current === generation) error.value = errorMessage(e) }
  finally { if (current === generation) loading.value = false }
}
async function openMemberPage(target: string) {
  try { if (await requireProfile(target)) navigate(target) }
  catch (e) { error.value = errorMessage(e) }
}
function editProfile() { if (session.member?.profileComplete) navigate(routes.profile); else loginPage(routes.profile) }
function openRegistrations() { void openMemberPage(routes.registrations) }
function invitation() { void openMemberPage(routes.invitation) }
async function logout() { const result = await uni.showModal({ title: '退出登录', content: '本次将退出，下次进入小程序时会重新识别微信身份，确认退出？' }); if (!result.confirm)
    return; try {
    await api.logout()
}
catch (e) {
    error.value = '本机已退出，远端会话撤销未确认：' + errorMessage(e)
}
finally {
    session.clear()
    count.value = null
    organizedCount.value = null
} }
watch(() => [session.token, session.epoch], () => { count.value = null; organizedCount.value = null; unreadCount.value = 0; loading.value = false; canEditContent.value = false }, { flush: 'sync' })
onShow(() => { active = true; void load() })
onHide(() => { active = false; generation++ })
onUnload(() => { active = false; generation++ })
</script>
<template>
  <view>
    <view class="mine-hero">
      <image
        class="hero-image"
        src="/static/huiju/campus.jpg"
        mode="aspectFill"
      /><view class="mine-fade" /><view class="identity row">
        <view class="avatar portrait">
          <image
            v-if="session.member?.avatarUrl"
            :src="mediaUrl(session.member.avatarUrl)"
            mode="aspectFill"
          /><uni-icons
            v-else
            type="person-filled"
            size="88rpx"
            color="#a4b6ac"
          />
        </view><view class="grow">
          <view class="name serif">{{ session.member?.profileComplete ? session.member.displayName : '游客' }}</view><view class="member-number">{{ session.member?.profileComplete ? '会员编号 '+session.member.memberNumber : '完善头像、用户名称和手机号后成为会员' }}</view><view class="complete">
            <uni-icons
              :type="session.member?.profileComplete?'checkbox-filled':'info'"
              size="32rpx"
              color="#296e52"
            /> {{ session.member?.profileComplete?'资料已完善':'完善资料，认识更多伙伴' }}
          </view>
        </view><button
          class="edit"
          @click="editProfile"
        >
          {{ session.member?.profileComplete?'编辑资料':'完善资料' }} <text
            class="entry-arrow"
            aria-hidden="true"
          >
            {{ '>' }}
          </text>
        </button>
      </view>
    </view>
    <view class="sheet mine-sheet">
      <view
        v-if="LOCAL_TEST"
        class="local-test-tools"
      >
        <view class="small">本地模拟身份：{{ testActorLabel }}</view>
        <button
          class="text-button"
          :disabled="switching"
          @click="chooseTestActor"
        >
          {{ switching ? '正在切换…' : '切换测试身份' }}
        </button>
        <view class="muted small">仅本机测试，手机号与身份模拟，业务数据保存到本地数据库。</view>
      </view>
      <view
        v-if="error"
        class="error"
      >
        {{ error }}<button
          class="text-button"
          @click="load"
        >
          重试
        </button>
      </view>
      <view class="namecard row">
        <view
          class="namecard-icon"
          aria-hidden="true"
        >
          <view class="namecard-halo" />
          <view class="namecard-symbol">
            <uni-icons
              type="person-filled"
              size="40rpx"
              color="#ffffff"
            />
            <view class="namecard-lines"><view /><view /></view>
          </view>
        </view><view class="grow"><view class="serif namecard-title">我的名片</view><view class="muted small">选择对同学展示的信息</view></view><button
          class="edit"
          @click="openMemberPage(routes.cardSettings)"
        >
          设置名片 <text
            class="entry-arrow"
            aria-hidden="true"
          >
            {{ '>' }}
          </text>
        </button>
      </view>
      <view class="activity-grid">
        <view
          class="tile"
          hover-class="tile-pressed"
          @click="openRegistrations"
        >
          <view class="row">
            <view class="tile-icon">
              <uni-icons
                type="calendar"
                size="50rpx"
                color="#17553f"
              />
            </view><view class="grow"><view class="tile-title">我报名的</view><view class="muted"><text class="number">{{ loading?'…':count===null?'—':count }}</text> 个活动</view></view><text
              class="entry-arrow"
              aria-hidden="true"
            >
              {{ '>' }}
            </text>
          </view><view class="muted small tile-desc">查看已报名的活动</view>
        </view><view
          class="tile"
          hover-class="tile-pressed"
          @click="openMemberPage(routes.organizedActivities)"
        >
          <view class="row">
            <view class="tile-icon">
              <uni-icons
                type="paperplane-filled"
                size="50rpx"
                color="#17553f"
              />
            </view><view class="grow"><view class="tile-title">我发起的</view><view class="muted"><text class="number">{{ loading?'…':organizedCount===null?'—':organizedCount }}</text> 个活动</view></view><text
              class="entry-arrow"
              aria-hidden="true"
            >
              {{ '>' }}
            </text>
          </view><view class="muted small tile-desc">查看我发起的活动</view>
        </view>
      </view>
      <view class="menu-card">
        <view
          class="menu-row row"
          hover-class="menu-pressed"
          @click="openMemberPage(routes.notifications)"
        >
          <view class="menu-icon">
            <uni-icons
              type="notification"
              size="48rpx"
              color="#17543d"
            />
          </view><view class="grow">
            <view class="tile-title notification-title">
              站内通知<text
                v-if="unreadCount > 0"
                class="unread-badge"
                :aria-label="unreadCount + '条未读通知'"
              >
                {{ unreadCount > 99 ? '99+' : unreadCount }}
              </text>
            </view><view class="muted small">已报名活动的变动消息</view>
          </view><text
            class="entry-arrow"
            aria-hidden="true"
          >
            {{ '>' }}
          </text>
        </view><view
          class="menu-row row"
          hover-class="menu-pressed"
          @click="invitation"
        >
          <view class="menu-icon">
            <uni-icons
              type="staff"
              size="48rpx"
              color="#17543d"
            />
          </view><view class="grow"><view class="tile-title">我的邀请码</view><view class="muted small">邀请同学加入有聚点</view></view><text
            class="entry-arrow"
            aria-hidden="true"
          >
            {{ '>' }}
          </text>
        </view>
        <view
          v-if="canEditContent"
          class="menu-row row"
          hover-class="menu-pressed"
          @click="navigate(routes.contentSettings)"
        >
          <view class="grow"><view class="tile-title">运营文案设置</view><view class="muted small">修改活动页和助手页文案</view></view><text class="entry-arrow">{{ '>' }}</text>
        </view>
        <view
          class="menu-row row"
          hover-class="menu-pressed"
          @click="navigate(routes.terms)"
        >
          <view class="grow"><view class="tile-title">用户协议</view></view><text class="entry-arrow">{{ '>' }}</text>
        </view>
        <view
          class="menu-row row"
          hover-class="menu-pressed"
          @click="navigate(routes.privacy)"
        >
          <view class="grow"><view class="tile-title">隐私政策</view></view><text class="entry-arrow">{{ '>' }}</text>
        </view>
      </view><button
        v-if="session.token"
        class="text-button logout"
        @click="logout"
      >
        退出登录
      </button>
    </view>
  </view>
</template>
<style scoped>
.local-test-tools { padding: 20rpx; margin-bottom: 22rpx; border: 1rpx dashed #b4c9bc; border-radius: 16rpx; background: #f1f7f3; }
.local-test-tools button { min-height: 88rpx; color: #17553f; }
.notification-title { display: flex; align-items: center; gap: 12rpx; }
.unread-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 34rpx; height: 34rpx; padding: 0 9rpx; border-radius: 18rpx; color: #fff; background: #dc3c3c; font-size: 22rpx; line-height: 1; font-weight: 500; }
.entry-arrow { flex-shrink: 0; font-family: Arial, sans-serif; font-size: 32rpx; font-weight: 400; line-height: 1; color: #78837c; }
.edit .entry-arrow { color: #275842; font-size: 30rpx; }
.mine-hero { position: relative; height: 390rpx; overflow: hidden; background: #eaf2f1; }
.mine-fade { position: absolute; inset: 0; background: linear-gradient(180deg, #ffffffeb, #ffffffb8 30%, #ffffff08 85%); }
.identity { position: relative; padding: 38rpx 34rpx; gap: 28rpx; align-items: flex-start; }
.portrait { width: 148rpx; height: 148rpx; border: 2rpx solid #ffffffb3; }
.identity .grow { padding-top: 6rpx; }
.name { margin: 6rpx 0 12rpx; padding-right: 164rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 40rpx; line-height: 1.25; color: #154e39; }
.member-number { font-size: 22rpx; line-height: 1.6; color: #717989; margin-bottom: 12rpx; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.complete { font-size: 24rpx; line-height: 1.5; color: #27634d; display: flex; align-items: center; gap: 10rpx; }
.edit { display: flex; align-items: center; justify-content: center; gap: 6rpx; flex-shrink: 0; min-height: 88rpx; padding: 14rpx 22rpx; font-size: 24rpx; line-height: 1.4; background: #f0f7f3ed; color: #174e3d; border: 1rpx solid #d5e3db; white-space: nowrap; }
.identity .edit { position: absolute; right: 32rpx; top: 38rpx; min-height: 88rpx; padding: 14rpx 18rpx; font-size: 23rpx; }
.mine-sheet { margin-top: -20rpx; min-height: 65vh; padding: 26rpx 32rpx calc(32rpx + env(safe-area-inset-bottom)); border-radius: 46rpx 46rpx 0 0; background: #fdfdfc; }
.namecard { min-height: 164rpx; padding: 28rpx 22rpx; border: 1rpx solid #e8e6df; border-radius: 16rpx; background: #fcfbf8; margin-bottom: 22rpx; gap: 18rpx; }
.namecard-icon { position: relative; width: 142rpx; height: 108rpx; flex-shrink: 0; }
.namecard-halo { position: absolute; right: 6rpx; top: 0; width: 80rpx; height: 80rpx; border-radius: 50%; background: #f1e4d1; }
.namecard-symbol { position: absolute; left: 12rpx; top: 24rpx; display: flex; align-items: center; justify-content: center; gap: 7rpx; width: 84rpx; height: 66rpx; border-radius: 9rpx; background: #185f48; box-shadow: inset 0 0 0 2rpx #ffffff14; }
.namecard-lines { display: flex; flex-direction: column; gap: 9rpx; }
.namecard-lines view { width: 24rpx; height: 4rpx; border-radius: 4rpx; background: #fff; }
.namecard-lines view + view { width: 17rpx; }
.namecard-title { font-size: 36rpx; line-height: 1.35; color: #164632; margin-bottom: 8rpx; }
.namecard .small { line-height: 1.55; font-size: 23rpx; }
.namecard .edit { min-height: 88rpx; padding: 14rpx 18rpx; }
.activity-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16rpx; margin-bottom: 22rpx; }
.tile { min-width: 0; min-height: 196rpx; padding: 24rpx 22rpx; border: 1rpx solid #e8e9e6; border-radius: 17rpx; background: #fff; }
.tile .row { gap: 14rpx; }
.tile-icon { background: #e8f0eb; border-radius: 24rpx; width: 86rpx; height: 92rpx; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.tile-title { font-size: 28rpx; font-weight: 600; line-height: 1.4; margin-bottom: 8rpx; color: #18271f; }
.tile .muted { font-size: 23rpx; line-height: 1.5; }
.number { font-size: 40rpx; line-height: 1.1; color: #1c7154; font-variant-numeric: tabular-nums; }
.tile-desc { margin-top: 22rpx; }
.menu-card { background: #fff; border: 1rpx solid #e8e9e6; border-radius: 19rpx; padding: 0 24rpx; }
.menu-row { padding: 28rpx 8rpx; gap: 24rpx; min-height: 134rpx; }
.menu-row + .menu-row { border-top: 1rpx solid #eaeeeb; }
.menu-icon { width: 68rpx; flex-shrink: 0; display: flex; justify-content: center; align-items: center; }
.menu-row .small { line-height: 1.55; }
.tile-pressed, .menu-pressed { background: #f0f6f2; }
.logout { min-height: 88rpx; margin: 26rpx auto 0; font-size: 24rpx; color: #7b8680; }
@media (max-width: 350px) {
  .namecard { gap: 12rpx; padding-left: 14rpx; padding-right: 14rpx; }
  .namecard-icon { width: 114rpx; }
  .namecard .edit { padding-left: 12rpx; padding-right: 12rpx; }
  .tile { padding-left: 16rpx; padding-right: 16rpx; }
  .tile .row { gap: 10rpx; }
}
</style>
