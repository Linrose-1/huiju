import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Member, Session } from '@/services/api/types'
import { API_BASE_URL } from '@/services/api/environment'
const storageKey = `huiju:session:${API_BASE_URL}`
export const useSessionStore = defineStore('session', () => {
  const token = ref('')
  const member = ref<Member | null>(null)
  const expiresAt = ref('')
  const epoch = ref(0)
  const pendingInvite = ref('')
  const identifying = ref(false)
  function clear() {
    epoch.value += 1
    token.value = ''
    member.value = null
    expiresAt.value = ''
    identifying.value = false
    uni.removeStorageSync(storageKey)
  }
  function restore() {
    const previousEnvironment = uni.getStorageSync('huiju:environment') as string
    if (previousEnvironment && previousEnvironment !== API_BASE_URL) uni.removeStorageSync(`huiju:session:${previousEnvironment}`)
    uni.setStorageSync('huiju:environment', API_BASE_URL)
    const cached = uni.getStorageSync(storageKey) as { token?: string; expiresAt?: string } | undefined
    if (cached?.token && cached.expiresAt && Date.parse(cached.expiresAt) > Date.now()) {
      token.value = cached.token
      expiresAt.value = cached.expiresAt
    } else clear()
  }
  function accept(session: Session) {
    token.value = session.token
    member.value = session.member
    expiresAt.value = session.expiresAt
    pendingInvite.value = ''
    uni.setStorageSync(storageKey, { token: session.token, expiresAt: session.expiresAt })
  }
  restore()
  return { token, member, expiresAt, epoch, pendingInvite, identifying, clear, accept }
})
