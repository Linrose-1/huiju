export type EvidenceValue<T = string> = { value: T; evidence: string }
export interface ParsedSearch {
  hard: {
    location?: EvidenceValue
    time?: { from: string; to: string; evidence: string }
    feeType?: EvidenceValue<'free' | 'paid'>
    themes?: EvidenceValue[]
  }
  preferences: { kind: 'location' | 'time' | 'feeType' | 'theme'; value: string; evidence: string }[]
  summary: string
  clarify: string | null
}
export interface PublicCandidate {
  id: string
  title: string
  description: string
  location: string
  startsAt: string
  endsAt: string
  feeType: 'free' | 'paid'
  feeAmountCents: number | null
}
export interface RankedCandidate { id: string; reason: string; preferenceDifferences: string[] }
