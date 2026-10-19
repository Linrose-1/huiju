export const ACTIVITY_BODY_MAX_LENGTH = 10000
export const ACTIVITY_BODY_MAX_OPS = 1000
export type ActivityRichAttributes = { bold?: boolean; italic?: boolean; underline?: boolean; list?: 'ordered' | 'bullet' }
export type ActivityRichDelta = { ops: { insert: string; attributes?: ActivityRichAttributes }[] }
export type ActivityRichValue = { text: string; delta: ActivityRichDelta | null }
export type ActivityRichNode = { type: 'text'; text: string } | { name: string; attrs?: Record<string, string>; children: ActivityRichNode[] }

// Only text inserts and the supported formats cross the editor/API boundary.
export function normalizeActivityRichText(delta: unknown, fallbackText = ''): { text: string; delta: ActivityRichDelta } {
  if (delta == null) return { text: fallbackText, delta: { ops: [{ insert: fallbackText + '\n' }] } }
  if (typeof delta !== 'object' || !('ops' in delta) || !Array.isArray(delta.ops)) throw new Error('正文格式无法识别，请使用文字内容。')
  if (delta.ops.length > ACTIVITY_BODY_MAX_OPS) throw new Error('正文格式片段过多，请减少格式切换后保存。')
  const ops: ActivityRichDelta['ops'] = []
  for (const op of delta.ops) {
    if (!op || typeof op.insert !== 'string') throw new Error('正文仅支持文字，不支持图片或其他嵌入内容。')
    if (!op.insert) continue
    const attributes: ActivityRichAttributes = {}
    for (const key of ['bold', 'italic', 'underline'] as const) if (op.attributes?.[key] === true) attributes[key] = true
    if (op.attributes?.list === 'ordered' || op.attributes?.list === 'bullet') attributes.list = op.attributes.list
    ops.push({ insert: op.insert, ...(Object.keys(attributes).length ? { attributes } : {}) })
  }
  const raw = ops.map(op => op.insert).join('')
  return { text: raw.endsWith('\n') ? raw.slice(0, -1) : raw, delta: { ops } }
}

export function activityRichTextNodes(delta: unknown, fallbackText = ''): ActivityRichNode[] {
  let value: ReturnType<typeof normalizeActivityRichText>
  try { value = normalizeActivityRichText(delta, fallbackText) }
  catch { value = normalizeActivityRichText(null, fallbackText) }
  const nodes: ActivityRichNode[] = []
  let line: ActivityRichNode[] = [], list: Extract<ActivityRichNode, { name: string }> | null = null
  const finish = (kind?: 'ordered' | 'bullet') => {
    const children = line.length ? line : [{ type: 'text' as const, text: '\u00a0' }]
    if (kind) {
      const name = kind === 'ordered' ? 'ol' : 'ul'
      if (!list || list.name !== name) { list = { name, attrs: { style: 'padding-left:1.5em;margin:0.5em 0;' }, children: [] }; nodes.push(list) }
      list.children.push({ name: 'li', children })
    } else { list = null; nodes.push({ name: 'p', attrs: { style: 'margin:0 0 0.5em;white-space:pre-wrap;' }, children }) }
    line = []
  }
  for (const op of value.delta.ops) {
    const parts = op.insert.split('\n')
    parts.forEach((part, index) => {
      if (part) {
        let node: ActivityRichNode = { type: 'text', text: part }
        for (const [attribute, name] of [['bold', 'strong'], ['italic', 'em']] as const) {
          if (op.attributes?.[attribute]) node = { name, children: [node] }
        }
        if (op.attributes?.underline) node = { name: 'span', attrs: { style: 'text-decoration:underline;' }, children: [node] }
        line.push(node)
      }
      if (index < parts.length - 1) finish(op.attributes?.list)
    })
  }
  if (line.length) finish()
  return nodes
}
