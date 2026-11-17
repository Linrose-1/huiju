import type { AiActivityDraft } from './api/types'
export type EditorAiDraft = AiActivityDraft & { imageUrls?:string[]; coverUrl?:string|null; coverSourceUrl?:string|null; latitude?:number|null; longitude?:number|null }

interface EditorDraft {
  owner: string
  epoch: number
  draft: EditorAiDraft
  consultationContact: string
  onSaved?: (activityId: string) => void
}
let pending: EditorDraft | null = null

export function stageActivityDraft(owner: string, epoch: number, draft: EditorAiDraft, consultationContact = '', onSaved?: EditorDraft['onSaved']) {
  pending = { owner, epoch, draft, consultationContact, onSaved }
}

export function takeActivityDraft(owner: string, epoch: number) {
  const entry = pending?.owner === owner && pending.epoch === epoch ? pending : null
  pending = null
  return entry
}
