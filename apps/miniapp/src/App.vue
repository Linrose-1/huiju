<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app'
import { useSessionStore } from '@/stores/session'
import { bootstrapIdentity } from '@/services/wechat'
import { LOCAL_TEST } from '@/services/api/environment'
function captureInvite(options: {
    query?: Record<string, unknown>
} | undefined) {
    const invite = options?.query?.inviteCode
    if (typeof invite === 'string' && invite.length <= 32)
        useSessionStore().pendingInvite = invite
}
onLaunch(options => { captureInvite(options); void bootstrapIdentity().catch(() => undefined); })
onShow(() => {
    if (LOCAL_TEST) uni.showToast({ title: '本地模拟测试', icon: 'none' })
    // #ifdef MP-WEIXIN
    captureInvite(uni.getEnterOptionsSync())
    // #endif
})
</script>
<style lang="scss">
@import '@/uni_modules/uni-scss/index.scss';
@import '@/styles/huiju.scss';
</style>
