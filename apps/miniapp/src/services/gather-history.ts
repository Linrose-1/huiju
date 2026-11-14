import type { GatherDraft, GatherField, GatherQuestion, GatherTurn } from './gather-dialog'

export type GatherChatSnapshot = {
  idea: string
  draft: GatherDraft | null
  exchanges: (GatherTurn & { facts?: string[] })[]
  reply: string
  sentIdea: string
  openingFacts: string[]
  manual: boolean
  modelCard: GatherQuestion | null
  custom: boolean | 'offline'
  editing: GatherField | null
  createdId: string
  uncertainCreate: boolean
}

export const GATHER_HISTORY_TTL = 7 * 24 * 60 * 60 * 1000

export type GatherHistoryItem = {
  id: string
  snapshot?: GatherChatSnapshot
  updatedAt: number
  idea: string
  openingFacts: string[]
  exchanges: { prompt: string; answer: string; facts?: string[] }[]
}

function writeHistory(key: string, items: GatherHistoryItem[]) {
  if (!items.length) uni.removeStorageSync(key + ':history')
  else uni.setStorageSync(key + ':history', JSON.stringify(items))
}

export function readGatherHistory(key: string): GatherHistoryItem[] {
  const raw = uni.getStorageSync(key + ':history')
  if (!raw) return []
  let saved: GatherHistoryItem[]
  try {
    saved = JSON.parse(raw)
  } catch {
    saved = []
  }
  const cutoff = Date.now() - GATHER_HISTORY_TTL
  const items = Array.isArray(saved) ? saved.filter(item => item && Number.isFinite(item.updatedAt) &&
    item.updatedAt > cutoff && typeof item.id === 'string' && typeof item.idea === 'string' &&
    Array.isArray(item.openingFacts) && Array.isArray(item.exchanges)) : []
  if (!items.length || items.length !== saved.length) writeHistory(key, items)
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function archiveGatherHistory(key: string, item: GatherHistoryItem) {
  const items = readGatherHistory(key)
  if (!Number.isFinite(item.updatedAt) || item.updatedAt <= Date.now() - GATHER_HISTORY_TTL) return
  const existing = items.find(previous => previous.id === item.id)
  if (existing && existing.updatedAt > item.updatedAt) return
  writeHistory(key, [item, ...items.filter(previous => previous.id !== item.id)])
}

export function removeGatherHistory(key: string, id: string) {
  const items = readGatherHistory(key)
  if (items.some(item => item.id === id)) writeHistory(key, items.filter(item => item.id !== id))
}
