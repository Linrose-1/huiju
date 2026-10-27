import { computed, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { useSessionStore } from '@/stores/session'
import { bootstrapIdentity } from '@/services/wechat'

type ShareTarget = { path: string; title: string; id?: string }

// Only public targets and the current sharer's source are allowed in the payload.
export function usePageShare(target: () => ShareTarget | null, timeline = false) {
  const session = useSessionStore()
  const shareError = ref(''), shareBusy = ref(false), visible = ref(false)
  const verifiedToken = ref(''), verifiedCode = ref('')
  const verifiedEpoch = ref(-1)
  let generation = 0
  const shareReady = computed(() => visible.value && !!target() && !!verifiedToken.value
    && verifiedEpoch.value === session.epoch && verifiedToken.value === session.token && !!verifiedCode.value && verifiedCode.value === session.member?.inviteCode)
  function updateMenu() {
    if (!visible.value) return
    // #ifdef MP-WEIXIN
    uni.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'], hideShareItems: ['shareAppMessage', 'shareTimeline'] })
    if (shareReady.value) uni.showShareMenu({ menus: timeline ? ['shareAppMessage', 'shareTimeline'] : ['shareAppMessage'] })
    // #endif
  }
  async function retryShare() {
    if (shareBusy.value || !visible.value) return
    const current = ++generation, epoch = session.epoch
    verifiedToken.value = ''; verifiedCode.value = ''; shareError.value = ''; shareBusy.value = true
    try {
      await bootstrapIdentity()
      if (current !== generation || !visible.value) return
      if (epoch !== session.epoch) { shareError.value = '身份已变更，请重试分享'; return }
      if (!session.token || !session.member?.inviteCode) throw new Error('missing identity')
      verifiedEpoch.value = session.epoch; verifiedToken.value = session.token; verifiedCode.value = session.member.inviteCode
    } catch {
      if (current === generation && visible.value) shareError.value = '身份识别未完成，暂不能分享。请重试'
    } finally {
      if (current === generation) shareBusy.value = false
    }
  }
  watch(() => [session.token, session.epoch, session.member?.inviteCode], () => {
    if (visible.value && !shareBusy.value && !shareReady.value) shareError.value = '身份已变更，请重试分享'
  }, { flush: 'sync' })
  watch(shareReady, updateMenu, { flush: 'sync' })
  onLoad(options => { session.captureInvite(options?.inviteCode) })
  onShow(() => { visible.value = true; updateMenu(); void retryShare() })
  const leave = () => { visible.value = false; generation++; shareBusy.value = false; verifiedToken.value = ''; verifiedCode.value = '' }
  onHide(leave); onUnload(leave)
  function payload() {
    const destination = target()
    if (!shareReady.value || !destination) throw new Error('分享身份尚未就绪')
    const query = (destination.id ? 'id=' + encodeURIComponent(destination.id) + '&' : '') + 'inviteCode=' + encodeURIComponent(verifiedCode.value)
    return { title: destination.title, path: destination.path + '?' + query, query }
  }
  // Do not let WeChat capture a private page (answers, contacts or organizer tools).
  const shareMessage = () => { const { title, path } = payload(); return { title, path, imageUrl: '/static/huiju/campus.jpg' } }
  // Timeline always opens the current page; private pages must never register it.
  const shareTimeline = () => { const { title, query } = payload(); return { title, query, imageUrl: '/static/huiju/campus.jpg' } }
  return { shareReady, shareError, shareBusy, retryShare, shareMessage, shareTimeline }
}
