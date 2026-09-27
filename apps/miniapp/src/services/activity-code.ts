// Only decode activity destinations; scanned content must never become an arbitrary route.
export function activityCodeTarget(value: string): { id: string; inviteCode?: string } | null {
  if (!value || value.length > 2048) return null
  const text = value.trim()
  let query: string
  const scheme = /^huiju:\/\/activity\/([a-f0-9-]+)(?:\?(.*))?$/i.exec(text)
  if (scheme) query = `id=${scheme[1]}${scheme[2] ? '&' + scheme[2] : ''}`
  else {
    const path = /^\/?pages\/activity\/detail\?([^#]+)$/.exec(text)
    if (!path) return null
    query = path[1]
  }
  const fields: Record<string, string> = {}
  try {
    for (const item of query.split('&')) {
      const pair = item.split('=')
      if (pair.length !== 2) return null
      const key = decodeURIComponent(pair[0]), data = decodeURIComponent(pair[1])
      if (!['id', 'inviteCode'].includes(key) || Object.prototype.hasOwnProperty.call(fields, key)) return null
      fields[key] = data
    }
  } catch { return null }
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(fields.id || '')) return null
  if (fields.inviteCode !== undefined && !/^[A-Za-z0-9_-]{1,32}$/.test(fields.inviteCode)) return null
  return { id: fields.id, ...(fields.inviteCode ? { inviteCode: fields.inviteCode } : {}) }
}
