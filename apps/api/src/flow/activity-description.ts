import { fail } from './common.js'

export type DescriptionDelta = { ops: { insert: string; attributes?: { bold?: boolean; italic?: boolean; underline?: boolean; list?: 'ordered' | 'bullet' } }[] }

export function activityDescription(description: string, delta?: DescriptionDelta | null) {
  if (delta == null) {
    if (typeof description !== 'string' || !description.trim() || description.length > 10000) fail('INVALID_ACTIVITY', '活动介绍须为1至10000字')
    return { description: description.trim(), descriptionDelta: null }
  }
  const invalid = () => fail('INVALID_ACTIVITY_DESCRIPTION', '活动介绍格式无效，仅支持文字、加粗、斜体、下划线和列表')
  const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
  if (!object(delta) || Object.keys(delta).some(key => key !== 'ops') || !Array.isArray(delta.ops) || !delta.ops.length || delta.ops.length > 1000) invalid()
  const ops: DescriptionDelta['ops'] = []
  let text = ''
  for (const op of delta.ops) {
    if (!object(op) || Object.keys(op).some(key => key !== 'insert' && key !== 'attributes') || typeof op.insert !== 'string') invalid()
    text += op.insert
    if (text.length > 10001) fail('INVALID_ACTIVITY_DESCRIPTION', '活动介绍不能超过10000字')
    const attributes: NonNullable<DescriptionDelta['ops'][number]['attributes']> = {}
    if (op.attributes !== undefined) {
      if (!object(op.attributes) || Object.keys(op.attributes).some(key => !['bold', 'italic', 'underline', 'list'].includes(key))) invalid()
      for (const key of ['bold', 'italic', 'underline'] as const) {
        if (op.attributes[key] !== undefined) {
          if (typeof op.attributes[key] !== 'boolean') invalid()
          attributes[key] = op.attributes[key]
        }
      }
      if (op.attributes.list !== undefined) {
        if (op.attributes.list !== 'ordered' && op.attributes.list !== 'bullet') invalid()
        attributes.list = op.attributes.list
      }
    }
    ops.push({ insert: op.insert, ...(Object.keys(attributes).length ? { attributes } : {}) })
  }
  if (!text.trim()) fail('INVALID_ACTIVITY_DESCRIPTION', '请填写活动介绍')
  if (text.trim().length > 10000) fail('INVALID_ACTIVITY_DESCRIPTION', '活动介绍不能超过10000字')
  return { description: text.trim(), descriptionDelta: { ops } }
}

export function activityRegistrationNotice(value?: string | null) {
  if (value == null) return null
  if (typeof value !== 'string' || value.length > 500) fail('INVALID_REGISTRATION_NOTICE', '报名须知不能超过500字')
  return value.trim() || null
}
