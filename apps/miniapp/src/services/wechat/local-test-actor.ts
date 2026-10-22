import { API_BASE_URL, LOCAL_TEST } from '@/services/api/environment'

export const localTestActors = [
  { key: 'owner', label: '林舟（测试）' },
  { key: 'planner', label: '许知夏（测试）' },
  { key: 'operator', label: '陈嘉木（测试）' },
  { key: 'provider', label: '苏雨禾（测试）' },
  { key: 'member', label: '周明远（测试）' },
  { key: 'peer', label: '叶青（测试）' },
  { key: 'visitor', label: '未完善资料（测试）' },
] as const
export type LocalTestActorKey = typeof localTestActors[number]['key']
const storageKey = `huiju:local-test-actor:${API_BASE_URL}`
function requireLocalTest() { if (!LOCAL_TEST) throw new Error('仅本地模拟测试可切换身份') }
export function getLocalTestActor() {
  requireLocalTest()
  const key = uni.getStorageSync(storageKey)
  return localTestActors.find(actor => actor.key === key) || localTestActors[0]
}
export function selectLocalTestActor(key: LocalTestActorKey) {
  requireLocalTest()
  if (!localTestActors.some(actor => actor.key === key)) throw new Error('测试身份不存在')
  uni.setStorageSync(storageKey, key)
}
export function localTestCode() {
  const actor = getLocalTestActor()
  return actor.key === 'owner' ? 'huiju-local-test' : `huiju-local-test:${actor.key}`
}
