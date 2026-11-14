import type { AiActivityDraft } from './api/types'

interface EditorDraft {
  owner: string
  epoch: number
  draft: AiActivityDraft
  consultationContact: string
  onSaved?: (activityId: string) => void
}
let pending: EditorDraft | null = null

export function stageActivityDraft(owner: string, epoch: number, draft: AiActivityDraft, consultationContact = '', onSaved?: EditorDraft['onSaved']) {
  pending = { owner, epoch, draft, consultationContact, onSaved }
}

export function takeActivityDraft(owner: string, epoch: number) {
  const entry = pending?.owner === owner && pending.epoch === epoch ? pending : null
  pending = null
  return entry
}
