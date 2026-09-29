import type { AiActivityDraft } from './api/types'

let pending: { owner: string; epoch: number; draft: AiActivityDraft } | null = null

export function stageActivityDraft(owner: string, epoch: number, draft: AiActivityDraft) {
  pending = { owner, epoch, draft }
}

export function takeActivityDraft(owner: string, epoch: number): AiActivityDraft | null {
  const draft = pending?.owner === owner && pending.epoch === epoch ? pending.draft : null
  pending = null
  return draft
}
