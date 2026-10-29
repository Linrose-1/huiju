import type { ConnectionPath } from '@/services/api/types'

/** Reject incomplete segments instead of labelling a partial path as complete. */
export function validateConnectionSegment(page: ConnectionPath, cursor: number, total?: number) {
  const invalid = () => { throw new Error('链路内容已变化或不完整，请下拉刷新后重试') }
  if (!page.connected) { if (cursor !== 0 || page.totalNodes !== 0 || page.nodes.length || page.edges.length || page.nextCursor !== null) invalid(); return }
  if (page.totalNodes < 1 || (total !== undefined && total !== page.totalNodes) || !page.nodes.length) invalid()
  const end = cursor + page.nodes.length
  if (end > page.totalNodes || page.nextCursor !== (end < page.totalNodes ? end : null)) invalid()
  if (page.nodes.some((node, i) => node.index !== cursor + i)) invalid()
  const expected = new Set(page.nodes.filter(node => node.index > 0).map(node => node.index))
  for (const edge of page.edges) {
    const upper = Math.max(edge.fromIndex, edge.toIndex)
    if (Math.abs(edge.fromIndex - edge.toIndex) !== 1 || !expected.delete(upper)) invalid()
  }
  if (expected.size) invalid()
}
