import { Injectable } from '@nestjs/common'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { FlowDatabase, fail } from '../flow/common.js'
import { complete, IdentityService, validAvatar } from '../flow/identity.js'
import { members, adminAccounts } from '../database/schema/members.js'
import { circlePosts, circleImages, circlePostImages, circleIntents, circleOperations } from '../database/schema/circle.js'
import { AvatarInput } from '../flow/dto.js'
import { CircleIntentInput, CirclePostDto, CircleQuery, CircleWriteInput, subtypes } from './dto.js'
import { PageQuery } from '../flow/pagination.js'
export type CircleTx = Parameters<Parameters<FlowDatabase['db']['transaction']>[0]>[0]
type Post = typeof circlePosts.$inferSelect
export function postState(post: Pick<Post, 'moderation' | 'lifecycle'>) { return post.moderation === 'removed' ? 'removed' : post.lifecycle }
export function requireAuthor(post: Post | undefined, memberId: string): asserts post is Post {
  if (!post) fail('NOT_FOUND', '帖子不存在', 404)
  if (post.authorId !== memberId) fail('FORBIDDEN', '仅发布者可以管理此帖子', 403)
}
export function postValues(input: CircleWriteInput) {
  if (!input.title?.trim() || !input.body?.trim()) fail('INVALID_POST', '请填写标题和正文')
  if (input.category === 'park' && !subtypes.includes(input.subtype!)) fail('INVALID_POST', '请选择园区资源类型')
  if (input.category === 'store' && !input.storeName?.trim()) fail('INVALID_POST', '请填写门店名称')
  if (input.validUntil) {
    const date = new Date(input.validUntil + 'T00:00:00Z')
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.validUntil) fail('INVALID_POST', '请填写有效日期')
  }
  const optional = (value?: string | null) => value?.trim() || null
  return { category: input.category, subtype: input.category === 'park' ? input.subtype! : null,
    title: input.title.trim(), body: input.body.trim(), location: optional(input.location),
    area: input.category === 'park' ? optional(input.area) : null, price: input.category === 'park' ? optional(input.price) : null,
    validUntil: input.category === 'park' ? optional(input.validUntil) : null, storeName: input.category === 'store' ? optional(input.storeName) : null }
}
@Injectable()
export class CircleService {
  constructor(private readonly database: FlowDatabase, private readonly identity: IdentityService) {}
  private directory() { return resolve(process.env.LOCAL_CIRCLE_DIRECTORY || '.local-uploads/circle') }
  private async profile(tx: CircleTx, memberId: string) {
    const [member] = await tx.select().from(members).where(eq(members.id, memberId)).for('update')
    if (!member || !complete(member)) fail('PROFILE_INCOMPLETE', '请先绑定手机号并设置头像、名称', 403)
  }
  private async present(db: CircleTx | FlowDatabase['db'], row: Post, ownerId?: string): Promise<CirclePostDto> {
    const isOwner = ownerId === row.authorId, state = postState(row)
    if (state === 'removed' && !isOwner) return { id: row.id, category: row.category, subtype: null, title: '内容已下架', body: '',
      location: null, area: null, price: null, validUntil: null, storeName: null, state, isOwner: false, author: null, images: [], removalReason: null, createdAt: row.createdAt.toISOString() }
    const [author] = await db.select({ id: members.id, displayName: members.displayName, avatarUrl: members.avatarUrl }).from(members).where(eq(members.id, row.authorId))
    const images = await db.select({ id: circleImages.id }).from(circlePostImages).innerJoin(circleImages, eq(circleImages.id, circlePostImages.imageId))
      .where(eq(circlePostImages.postId, row.id)).orderBy(asc(circlePostImages.position))
    return { id: row.id, category: row.category, subtype: row.subtype, title: row.title, body: row.body, location: row.location, area: row.area,
      price: row.price, validUntil: row.validUntil, storeName: row.storeName, state, isOwner, author: author ?? null,
      images: images.map(image => ({ id: image.id, url: '/api/v1/circle/images/' + image.id })), removalReason: isOwner ? row.removalReason : null, createdAt: row.createdAt.toISOString() }
  }
  async list(query = new CircleQuery(), header?: string, mine = false) {
    const member = mine ? (await this.identity.require(header))! : undefined
    const where = and(mine ? eq(circlePosts.authorId, member!.id) : eq(circlePosts.moderation, 'normal'),
      query.category === 'all' ? undefined : eq(circlePosts.category, query.category as CircleWriteInput['category']))
    return this.database.db.transaction(async tx => {
      const rows = await tx.select().from(circlePosts).where(where).orderBy(desc(circlePosts.createdAt), desc(circlePosts.id)).limit(query.limit + 1).offset(query.offset)
      return { items: await Promise.all(rows.slice(0, query.limit).map(row => this.present(tx, row, member?.id))), hasMore: rows.length > query.limit }
    })
  }
  async detail(id: string, header?: string, manage = false) {
    const member = await this.identity.require(header, !manage)
    return this.database.db.transaction(async tx => {
      const [row] = await tx.select().from(circlePosts).where(eq(circlePosts.id, id))
      if (!row) fail('NOT_FOUND', '帖子不存在', 404)
      if (manage) requireAuthor(row, member!.id)
      return this.present(tx, row, member?.id)
    })
  }
  private async attach(tx: CircleTx, postId: string, imageIds: string[], memberId: string) {
    if (imageIds.length) {
      const images = await tx.select().from(circleImages).where(inArray(circleImages.id, imageIds))
      if (images.length !== imageIds.length || images.some(image => image.ownerId !== memberId)) fail('INVALID_IMAGE', '请选择本人上传的图片')
    }
    await tx.delete(circlePostImages).where(eq(circlePostImages.postId, postId))
    if (imageIds.length) await tx.insert(circlePostImages).values(imageIds.map((imageId, position) => ({ id: randomUUID(), postId, imageId, position })))
  }
  async save(input: CircleWriteInput, header?: string, id?: string) {
    const member = (await this.identity.require(header))!, values = postValues(input)
    const postId = await this.database.db.transaction(async tx => {
      await this.profile(tx, member.id)
      if (id) {
        const [post] = await tx.select().from(circlePosts).where(eq(circlePosts.id, id)).for('update')
        requireAuthor(post, member.id)
        if (post.lifecycle === 'ended' && post.moderation !== 'removed') fail('POST_ENDED', '帖子已结束，不能修改', 409)
        await tx.update(circlePosts).set({ ...values, updatedAt: new Date() }).where(eq(circlePosts.id, id))
      } else {
        const [existing] = await tx.select().from(circlePosts).where(and(eq(circlePosts.authorId, member.id), eq(circlePosts.requestId, input.requestId)))
        if (existing) return existing.id
        id = randomUUID()
        await tx.insert(circlePosts).values({ id, authorId: member.id, requestId: input.requestId, ...values })
      }
      await this.attach(tx, id, input.imageIds, member.id)
      return id
    })
    return this.detail(postId, header, true)
  }
  async end(id: string, header?: string) {
    const member = (await this.identity.require(header))!
    await this.database.db.transaction(async tx => {
      const [post] = await tx.select().from(circlePosts).where(eq(circlePosts.id, id)).for('update')
      requireAuthor(post, member.id)
      if (post.moderation === 'removed') fail('POST_REMOVED', '下架帖子不能主动结束', 409)
      if (post.lifecycle === 'open') await tx.update(circlePosts).set({ lifecycle: 'ended', updatedAt: new Date() }).where(eq(circlePosts.id, id))
    })
    return { ok: true }
  }
  async intent(id: string, input: CircleIntentInput, header?: string) {
    const member = (await this.identity.require(header))!
    return this.database.db.transaction(async tx => {
      await this.profile(tx, member.id)
      const [post] = await tx.select().from(circlePosts).where(eq(circlePosts.id, id)).for('update')
      if (!post) fail('NOT_FOUND', '帖子不存在', 404)
      const [existing] = await tx.select({ id: circleIntents.id }).from(circleIntents).where(and(eq(circleIntents.postId, id), eq(circleIntents.memberId, member.id), eq(circleIntents.requestId, input.requestId)))
      if (existing) return { ok: true }
      if (postState(post) !== 'open') fail('POST_UNAVAILABLE', '帖子已结束或下架，不再接收新意向', 409)
      await tx.insert(circleIntents).values({ id: randomUUID(), postId: id, memberId: member.id, requestId: input.requestId, phone: input.phone.trim() })
      return { ok: true }
    })
  }
  async intents(id: string, query: PageQuery, header?: string) {
    const member = (await this.identity.require(header))!
    return this.database.db.transaction(async tx => {
      const [post] = await tx.select().from(circlePosts).where(eq(circlePosts.id, id))
      requireAuthor(post, member.id)
      const rows = await tx.select({ intent: circleIntents, member: { id: members.id, displayName: members.displayName, avatarUrl: members.avatarUrl } }).from(circleIntents)
        .innerJoin(members, eq(members.id, circleIntents.memberId)).where(eq(circleIntents.postId, id)).orderBy(desc(circleIntents.createdAt), desc(circleIntents.id)).limit(query.limit + 1).offset(query.offset)
      return { hasMore: rows.length > query.limit, items: rows.slice(0, query.limit).map(({ intent, member }) => ({ id: intent.id, member, phone: intent.phone, createdAt: intent.createdAt.toISOString() })) }
    })
  }
  async upload(input: AvatarInput, header?: string) {
    const member = (await this.identity.require(header))!
    if (!complete(member)) fail('PROFILE_INCOMPLETE', '请先完善资料', 403)
    const bytes = await validAvatar(input), id = randomUUID(), filename = id + (input.mimeType === 'image/png' ? '.png' : '.jpg')
    await mkdir(this.directory(), { recursive: true })
    const path = resolve(this.directory(), filename)
    await writeFile(path, bytes, { flag: 'wx' })
    try {
      await this.database.db.transaction(async tx => { await this.profile(tx, member.id); await tx.insert(circleImages).values({ id, ownerId: member.id, filename }) })
    } catch (error) { await unlink(path).catch(() => undefined); throw error }
    return { id, url: '/api/v1/circle/images/' + id }
  }
  async image(id: string, header?: string) {
    const [image] = await this.database.db.select().from(circleImages).where(eq(circleImages.id, id))
    if (!image) fail('NOT_FOUND', '图片不存在', 404)
    const [publicUse] = await this.database.db.select({ id: circlePosts.id }).from(circlePostImages).innerJoin(circlePosts, eq(circlePosts.id, circlePostImages.postId))
      .where(and(eq(circlePostImages.imageId, id), eq(circlePosts.moderation, 'normal'))).limit(1)
    if (!publicUse) {
      const member = await this.identity.require(header, true)
      if (member?.id !== image.ownerId) fail('NOT_FOUND', '图片不存在', 404)
    }
    if (!/^[a-f0-9-]{36}\.(png|jpg)$/.test(image.filename)) fail('NOT_FOUND', '图片不存在', 404)
    try { return { bytes: await readFile(resolve(this.directory(), image.filename)), type: image.filename.endsWith('.png') ? 'image/png' : 'image/jpeg' } }
    catch { fail('NOT_FOUND', '图片不存在', 404) }
  }
  async adminList(tx: CircleTx, query: CircleQuery) {
    const rows = await tx.select().from(circlePosts).where(query.category === 'all' ? undefined : eq(circlePosts.category, query.category as CircleWriteInput['category']))
      .orderBy(desc(circlePosts.createdAt), desc(circlePosts.id)).limit(query.limit + 1).offset(query.offset)
    return { hasMore: rows.length > query.limit, items: await Promise.all(rows.slice(0, query.limit).map(row => this.present(tx, row, row.authorId))) }
  }
  async moderate(tx: CircleTx, id: string, action: 'remove' | 'restore', reason: string, adminId: string) {
    if (!reason?.trim() || reason.trim().length > 1000) fail('INVALID_REASON', '请填写 1–1000 字操作原因')
    const [post] = await tx.select().from(circlePosts).where(eq(circlePosts.id, id)).for('update')
    if (!post) fail('NOT_FOUND', '帖子不存在', 404)
    const moderation = action === 'remove' ? 'removed' : 'normal'
    if (post.moderation !== moderation) {
      await tx.update(circlePosts).set({ moderation, removalReason: action === 'remove' ? reason.trim() : null, updatedAt: new Date() }).where(eq(circlePosts.id, id))
      await tx.insert(circleOperations).values({ id: randomUUID(), postId: id, adminId, action, reason: reason.trim() })
    }
    return { ok: true }
  }
  async history(tx: CircleTx, id: string, query: PageQuery) {
    const [post] = await tx.select({ id: circlePosts.id }).from(circlePosts).where(eq(circlePosts.id, id))
    if (!post) fail('NOT_FOUND', '帖子不存在', 404)
    const rows = await tx.select({ operation: circleOperations, actorName: adminAccounts.displayName }).from(circleOperations).leftJoin(adminAccounts, eq(adminAccounts.id, circleOperations.adminId))
      .where(eq(circleOperations.postId, id)).orderBy(desc(circleOperations.createdAt), desc(circleOperations.id)).limit(query.limit + 1).offset(query.offset)
    return { hasMore: rows.length > query.limit, items: rows.slice(0, query.limit).map(({ operation, actorName }) => ({ id: operation.id, action: operation.action, reason: operation.reason, actorName, createdAt: operation.createdAt.toISOString() })) }
  }
}
