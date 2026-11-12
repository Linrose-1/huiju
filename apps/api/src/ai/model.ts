export function aiModel(): string {
  return process.env.AI_MODEL?.trim() || 'gpt-5.6-sol'
}
