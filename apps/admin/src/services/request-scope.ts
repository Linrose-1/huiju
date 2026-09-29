import { onScopeDispose } from 'vue'
import { session } from './admin'

// Every view owns its request lifetime; leaving it or changing identity invalidates pending work.
export function useRequestScope() {
  let active = true
  let generation = 0
  onScopeDispose(() => { active = false; generation += 1 })
  return () => {
    const current = ++generation
    const epoch = session.epoch
    return () => active && current === generation && epoch === session.epoch
  }
}
