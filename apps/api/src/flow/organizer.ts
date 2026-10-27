import { Injectable } from '@nestjs/common'
import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { activities, activityOperations, registrationQuestions } from '../database/schema/activities.js'
import { members } from '../database/schema/members.js'
import { NotificationService } from '../notifications/service.js'
import { NotificationDelivery } from '../notifications/delivery.js'
import { registrations } from '../database/schema/registrations.js'
import { registrationState } from './activity.js'
import { fail, FlowDatabase } from './common.js'
import { complete, IdentityService, validAvatar } from './identity.js'
import { AvatarInput } from './dto.js'
import { ActivityQuestionHistoryDto, ActivityWriteInput, AttendanceDto, ManagedActivityDto } from './organizer-dto.js'
import { PageQuery, MyActivityQuery, RosterQuery, activityStatusSql, activityCounts, answersForRegistrations } from './pagination.js'
import { activityDescription, activityRegistrationNotice } from './activity-description.js'

type Activity = typeof activities.$inferSelect
type Question = typeof registrationQuestions.$inferSelect
type Tx = Parameters<Parameters<FlowDatabase['db']['transaction']>[0]>[0]
const coverName = /^[a-f0-9-]{36}_[a-f0-9-]{36}\.(png|jpg)$/
const coverPrefix = '/api/v1/media/covers/'

export function activityValues(input: ActivityWriteInput) {
  const latitude = input.locationLatitude ?? null, longitude = input.locationLongitude ?? null
  if ((latitude === null) !== (longitude === null)
    || (latitude !== null && (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90))
    || (longitude !== null && (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
    fail('INVALID_ACTIVITY_LOCATION', '请重新选择有效的地图位置，经纬度须成对提供')
  }
  const description = activityDescription(input.description, input.descriptionDelta)
  if ([input.title, input.location, input.consultationContact].some(value => !value?.trim())) fail('INVALID_ACTIVITY', '请填写完整的活动必填信息')
  const startsAt = new Date(input.startsAt)
  const endsAt = new Date(input.endsAt)
  const registrationDeadline = input.registrationDeadline ? new Date(input.registrationDeadline) : null
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt
    || (registrationDeadline && (!Number.isFinite(registrationDeadline.getTime()) || registrationDeadline > startsAt))) {
    fail('INVALID_ACTIVITY_TIME', '结束时间须晚于开始时间，报名截止时间不能晚于开始时间')
  }
  if ((input.feeType === 'paid' && (!Number.isInteger(input.feeAmountCents) || input.feeAmountCents! <= 0))
    || (input.feeType === 'free' && input.feeAmountCents != null)) fail('INVALID_ACTIVITY_FEE', '收费活动须填写正数金额，免费活动不能设置金额')
  if (input.coverUrl && !/^https:\/\/[^\s]+$/.test(input.coverUrl)
    && !(input.coverUrl.startsWith(coverPrefix) && coverName.test(input.coverUrl.slice(coverPrefix.length)))) fail('INVALID_COVER', '请选择有效的活动封面')
  const ids = input.questions.flatMap(q => q.id ? [q.id] : [])
  if (new Set(ids).size !== ids.length) fail('INVALID_QUESTIONS', '报名问题不能重复')
  for (const q of input.questions) {
    if (!q.prompt?.trim()) fail('INVALID_QUESTIONS', '请填写报名问题')
    const choices = q.type === 'single' || q.type === 'multiple'
    if (choices ? !q.options?.length || q.options.some(o => !o.trim()) || new Set(q.options).size !== q.options.length : Boolean(q.options?.length)) {
      fail('INVALID_QUESTIONS', '选择题须设置不重复的有效选项，文本题不能设置选项')
    }
  }
  return {
    title: input.title.trim(), ...description, registrationNotice: activityRegistrationNotice(input.registrationNotice), coverUrl: input.coverUrl ?? null,
    location: input.location.trim(), locationLatitude: latitude, locationLongitude: longitude, consultationContact: input.consultationContact.trim(),
    startsAt, endsAt, registrationDeadline, capacity: input.capacity ?? null,
    feeType: input.feeType, feeAmountCents: input.feeAmountCents ?? null
  }
}

export function requireOrganizer(activity: Activity | undefined, memberId: string): asserts activity is Activity {
  if (!activity) fail('NOT_FOUND', '活动不存在', 404)
  if (activity.organizerMemberId !== memberId) fail('FORBIDDEN', '仅活动发起人可以管理此活动', 403)
}

export function validateActivityEdit(activity: Activity, questions: Question[], input: ActivityWriteInput, now = new Date()) {
  const preserveCoordinates = input.locationLatitude === undefined && input.locationLongitude === undefined && input.location.trim() === activity.location
  const values = activityValues({ ...input,
    locationLatitude: preserveCoordinates ? activity.locationLatitude : input.locationLatitude,
    locationLongitude: preserveCoordinates ? activity.locationLongitude : input.locationLongitude,
    descriptionDelta: input.descriptionDelta === undefined && input.description.trim() === activity.description ? activity.descriptionDelta : input.descriptionDelta,
    registrationNotice: input.registrationNotice === undefined ? activity.registrationNotice : input.registrationNotice,
  })
  if (activity.lifecycle === 'cancelled' || activity.moderation === 'removed') fail('ACTIVITY_UNAVAILABLE', '活动已取消或下架，不能编辑', 409)
  const sameQuestions = questions.length === input.questions.length && questions.every((q, index) => {
    const other = input.questions[index]
    return q.id === other.id && q.type === other.type && q.prompt === other.prompt.trim() && q.required === other.required
      && JSON.stringify(q.options ?? []) === JSON.stringify(other.options ?? [])
  })
  if (activity.hasRegistrationEver && (!sameQuestions || activity.feeType !== values.feeType || activity.feeAmountCents !== values.feeAmountCents)) {
    fail('ACTIVITY_FIELDS_LOCKED', '已有报名记录，报名问题、收费模式和金额不能修改', 409)
  }
  if (values.capacity !== null && values.capacity < activity.activeRegistrationCount) fail('CAPACITY_BELOW_REGISTRATIONS', '人数上限不能低于当前有效报名人数', 409)
  if (activity.lifecycle === 'published' && now >= activity.endsAt) fail('ACTIVITY_ENDED', '活动已结束，不能编辑', 409)
  if (activity.lifecycle === 'published' && now >= activity.startsAt) {
    const changed = Object.entries(values).some(([key, value]) => {
      if (key === 'consultationContact') return false
      const original = activity[key as keyof typeof values]
      if (key === 'descriptionDelta') return JSON.stringify(value) !== JSON.stringify(original == null ? null : activityDescription(activity.description, activity.descriptionDelta).descriptionDelta)
      if (key === 'registrationNotice') return value !== (original ?? null)
      if (key === 'locationLatitude' || key === 'locationLongitude') return value !== (original ?? null)
      // A missing deadline and the start time have identical meaning.
      if (key === 'registrationDeadline') return (value as Date | null)?.getTime() !== (activity.registrationDeadline ?? activity.startsAt).getTime()
        && (value as Date | null)?.getTime() !== activity.registrationDeadline?.getTime()
      return value instanceof Date ? value.getTime() !== (original as Date).getTime() : value !== original
    })
    if (changed || !sameQuestions) fail('ACTIVITY_STARTED', '活动已开始，仅可修改活动咨询联系方式', 409)
  } else if (values.startsAt <= now) fail('INVALID_ACTIVITY_TIME', '开始时间须晚于当前时间')
  const known = new Set(questions.map(q => q.id))
  if (input.questions.some(q => q.id && !known.has(q.id))) fail('INVALID_QUESTIONS', '报名问题不属于此活动')
  return { values, sameQuestions }
}

@Injectable()
export class OrganizerService {
  constructor(private readonly database: FlowDatabase, private readonly identity: IdentityService,
    private readonly delivery: NotificationDelivery = new NotificationDelivery(),
    private readonly notificationQueries: NotificationService = new NotificationService(database, identity)) {}

  private coverDirectory() { return resolve(process.env.LOCAL_COVER_DIRECTORY || '.local-uploads/covers') }

  async uploadCover(input: AvatarInput, header?: string) {
    const member = (await this.identity.require(header))!
    if (!complete(member)) fail('PROFILE_INCOMPLETE', '请先绑定手机号并设置头像、名称', 403)
    const bytes = await validAvatar(input)
    const name = `${member.id}_${randomUUID()}.${input.mimeType === 'image/png' ? 'png' : 'jpg'}`
    await mkdir(this.coverDirectory(), { recursive: true })
    await writeFile(resolve(this.coverDirectory(), name), bytes, { flag: 'wx' })
    return { coverUrl: coverPrefix + name }
  }

  async coverImage(name: string) {
    if (!coverName.test(name)) fail('NOT_FOUND', '图片不存在', 404)
    try { return await readFile(resolve(this.coverDirectory(), name)) }
    catch { fail('NOT_FOUND', '图片不存在', 404) }
  }

  private async checkCover(url: string | null | undefined, memberId: string) {
    if (!url?.startsWith(coverPrefix)) return
    const name = url.slice(coverPrefix.length)
    if (!name.startsWith(memberId + '_')) fail('INVALID_COVER', '请使用本人上传的封面')
    await this.coverImage(name)
  }

  private async owner(tx: Tx, id: string, memberId: string) {
    const [activity] = await tx.select().from(activities).where(eq(activities.id, id)).for('update')
    requireOrganizer(activity, memberId)
    return activity
  }

  private async profile(tx: Tx, memberId: string) {
    const [member] = await tx.select().from(members).where(eq(members.id, memberId))
    if (!member || !complete(member)) fail('PROFILE_INCOMPLETE', '请先绑定手机号并设置头像、名称', 403)
  }

  private async present(activity: Activity): Promise<ManagedActivityDto> {
    const db = this.database.db
    const questions = await db.select({ id: registrationQuestions.id, type: registrationQuestions.type, prompt: registrationQuestions.prompt, required: registrationQuestions.required, options: registrationQuestions.options })
      .from(registrationQuestions).where(eq(registrationQuestions.activityId, activity.id)).orderBy(asc(registrationQuestions.sortOrder))
    const [organizer] = await db.select({ memberId: members.id, avatarUrl: members.avatarUrl, displayName: members.displayName }).from(members).where(eq(members.id, activity.organizerMemberId))
    return {
      id: activity.id, title: activity.title, description: activity.description, coverUrl: activity.coverUrl,
      descriptionDelta: activity.descriptionDelta ?? null, registrationNotice: activity.registrationNotice ?? null,
      location: activity.location, locationLatitude: activity.locationLatitude ?? null, locationLongitude: activity.locationLongitude ?? null, consultationContact: activity.consultationContact,
      startsAt: activity.startsAt.toISOString(), endsAt: activity.endsAt.toISOString(),
      registrationDeadline: (activity.registrationDeadline ?? activity.startsAt).toISOString(),
      capacity: activity.capacity, activeRegistrationCount: activity.activeRegistrationCount,
      cancellationRegistrationCount: activity.cancellationRegistrationCount, feeType: activity.feeType,
      feeAmountCents: activity.feeAmountCents, cancellationReason: activity.cancellationReason,
      registrationState: registrationState(activity), lifecycle: activity.lifecycle, moderation: activity.moderation,
      hasRegistrationEver: activity.hasRegistrationEver, questions, organizer: organizer ?? null
    }
  }

  async detail(id: string, header?: string) {
    const member = (await this.identity.require(header))!
    const [activity] = await this.database.db.select().from(activities).where(eq(activities.id, id))
    requireOrganizer(activity, member.id)
    return this.present(activity)
  }

  async list(header?: string, query: MyActivityQuery = new MyActivityQuery()) {
    const member = (await this.identity.require(header))!
    const where = eq(activities.organizerMemberId, member.id)
    const status = activityStatusSql()
    const totals = await this.database.db.select({ status, value: count() }).from(activities).where(where).groupBy(status)
    const counts = activityCounts(totals)
    const rows = await this.database.db.select().from(activities)
      .where(and(where, query.status !== 'all' ? sql`${status} = ${query.status}` : undefined))
      .orderBy(desc(activities.createdAt), desc(activities.id)).limit(query.limit + 1).offset(query.offset)
    return { items: await Promise.all(rows.slice(0, query.limit).map(row => this.present(row))), hasMore: rows.length > query.limit, total: counts.all, counts }
  }

  async questionHistory(header?: string, query: PageQuery = new PageQuery()): Promise<ActivityQuestionHistoryDto> {
    const member = (await this.identity.require(header))!
    if (!complete(member)) fail('PROFILE_INCOMPLETE', '请先绑定手机号并设置头像、名称', 403)
    // Group the full configuration before paging. A fixed-size digest avoids MySQL's
    // max_sort_length truncation when grouping long prompts/options as text or JSON.
    const configuration = sql`sha2(cast(json_array(${registrationQuestions.prompt}, ${registrationQuestions.type}, ${registrationQuestions.options}) as char), 256)`
    const rows = await this.database.db.select({
      prompt: sql<string>`min(${registrationQuestions.prompt})`,
      type: sql<Question['type']>`min(${registrationQuestions.type})`,
      options: sql`min(cast(${registrationQuestions.options} as char))`.mapWith((value: string) => JSON.parse(value) as string[]),
    }).from(registrationQuestions)
      .innerJoin(activities, eq(registrationQuestions.activityId, activities.id))
      .where(eq(activities.organizerMemberId, member.id))
      .groupBy(configuration)
      .orderBy(desc(sql`max(${activities.updatedAt})`), desc(sql`max(${registrationQuestions.id})`))
      .limit(query.limit + 1).offset(query.offset)
    return { items: rows.slice(0, query.limit).map(row => ({ prompt: row.prompt, type: row.type, options: row.options ?? null })), hasMore: rows.length > query.limit }
  }

  private async questions(tx: Tx, id: string, input: ActivityWriteInput) {
    await tx.delete(registrationQuestions).where(eq(registrationQuestions.activityId, id))
    if (input.questions.length) await tx.insert(registrationQuestions).values(input.questions.map((q, index) => ({
      id: q.id ?? randomUUID(), activityId: id, type: q.type, prompt: q.prompt.trim(), required: q.required,
      options: q.options?.length ? q.options : null, sortOrder: index
    })))
  }

  async create(input: ActivityWriteInput, header?: string) {
    const member = (await this.identity.require(header))!
    const values = activityValues(input)
    await this.checkCover(input.coverUrl, member.id)
    if (values.startsAt <= new Date()) fail('INVALID_ACTIVITY_TIME', '开始时间须晚于当前时间')
    if (input.questions.some(q => q.id)) fail('INVALID_QUESTIONS', '新活动不能使用已有问题编号')
    const id = randomUUID()
    await this.database.db.transaction(async tx => {
      await this.profile(tx, member.id)
      await tx.insert(activities).values({ id, organizerMemberId: member.id, ...values })
      await this.questions(tx, id, input)
    })
    return this.detail(id, header)
  }

  private notify(tx: Tx, activity: Activity, type: 'activity_cancelled' | 'consultation_contact_updated', body: string) {
    return this.delivery.activityChanged(tx, activity.id, type,
      type === 'activity_cancelled' ? '活动已取消' : '活动咨询联系方式已更新', body)
  }

  async edit(id: string, input: ActivityWriteInput, header?: string) {
    const member = (await this.identity.require(header))!
    await this.database.db.transaction(async tx => {
      const activity = await this.owner(tx, id, member.id)
      const questions = await tx.select().from(registrationQuestions).where(eq(registrationQuestions.activityId, id)).orderBy(asc(registrationQuestions.sortOrder))
      const { values, sameQuestions } = validateActivityEdit(activity, questions, input)
      await this.checkCover(input.coverUrl, member.id)
      await tx.update(activities).set(values).where(eq(activities.id, id))
      if (!sameQuestions) await this.questions(tx, id, input)
      if (activity.consultationContact !== values.consultationContact) {
        await tx.insert(activityOperations).values({ id: randomUUID(), activityId: id, actorType: 'member', actorMemberId: member.id, action: 'update_consultation_contact', changeSummary: { previous: activity.consultationContact, current: values.consultationContact } })
        await this.notify(tx, activity, 'consultation_contact_updated', `《${activity.title}》的咨询联系方式已更新，请进入活动查看。`)
      }
    })
    return this.detail(id, header)
  }

  async publish(id: string, header?: string) {
    const member = (await this.identity.require(header))!
    await this.database.db.transaction(async tx => {
      const activity = await this.owner(tx, id, member.id)
      if (activity.moderation === 'removed' || activity.lifecycle === 'cancelled') fail('ACTIVITY_UNAVAILABLE', '活动已取消或下架，不能发布', 409)
      if (activity.lifecycle === 'published') return
      await this.profile(tx, member.id)
      const questions = await tx.select().from(registrationQuestions).where(eq(registrationQuestions.activityId, id)).orderBy(asc(registrationQuestions.sortOrder))
      activityValues({ ...activity, startsAt: activity.startsAt.toISOString(), endsAt: activity.endsAt.toISOString(), registrationDeadline: activity.registrationDeadline?.toISOString() ?? null, questions })
      if (activity.startsAt <= new Date()) fail('INVALID_ACTIVITY_TIME', '开始时间已过，请先修改活动时间')
      await tx.update(activities).set({ lifecycle: 'published', publishedAt: new Date() }).where(eq(activities.id, id))
      await tx.insert(activityOperations).values({ id: randomUUID(), activityId: id, actorType: 'member', actorMemberId: member.id, action: 'publish' })
    })
    return this.detail(id, header)
  }

  async cancel(id: string, reason: string, header?: string) {
    if (!reason?.trim()) fail('INVALID_REASON', '请填写取消原因')
    const member = (await this.identity.require(header))!
    await this.database.db.transaction(async tx => {
      const activity = await this.owner(tx, id, member.id)
      if (activity.lifecycle === 'cancelled') return
      if (activity.lifecycle !== 'published' || new Date() >= activity.startsAt) fail('CANCELLATION_CLOSED', '仅能取消开始前已发布的活动', 409)
      await tx.update(activities).set({ lifecycle: 'cancelled', cancelledAt: new Date(), cancellationReason: reason.trim(), cancellationRegistrationCount: activity.activeRegistrationCount }).where(eq(activities.id, id))
      await tx.insert(activityOperations).values({ id: randomUUID(), activityId: id, actorType: 'member', actorMemberId: member.id, action: 'cancel', reason: reason.trim() })
      await this.notify(tx, activity, 'activity_cancelled', `《${activity.title}》已取消。原因：${reason.trim()}`)
    })
    return this.detail(id, header)
  }

  async markAttendance(id: string, registrationId: string, header?: string): Promise<AttendanceDto> {
    const member = (await this.identity.require(header))!
    return this.database.db.transaction(async tx => {
      const activity = await this.owner(tx, id, member.id)
      await this.profile(tx, member.id)
      if (activity.lifecycle !== 'published' || activity.moderation === 'removed') fail('ACTIVITY_UNAVAILABLE', '活动未发布、已取消或下架，不能标记到场', 409)
      const where = and(eq(registrations.id, registrationId), eq(registrations.activityId, id))
      const [registration] = await tx.select().from(registrations).where(where).for('update')
      if (!registration) fail('NOT_FOUND', '报名记录不存在', 404)
      if (registration.status !== 'active') fail('REGISTRATION_INACTIVE', '报名已取消，不能标记到场', 409)
      if (registration.attended) return { registrationId, attended: true, attendedAt: registration.attendedAt!.toISOString() }
      const attendedAt = new Date()
      await tx.update(registrations).set({ attended: true, attendedAt, attendanceMarkedByMemberId: member.id }).where(where)
      return { registrationId, attended: true, attendedAt: attendedAt.toISOString() }
    })
  }

  async roster(id: string, header?: string, query: RosterQuery = new RosterQuery()) {
    const member = (await this.identity.require(header))!
    const [activity] = await this.database.db.select().from(activities).where(eq(activities.id, id))
    requireOrganizer(activity, member.id)
    const where = eq(registrations.activityId, id)
    const [totals] = await this.database.db.select({ total: count(),
      activeCount: sql<number>`coalesce(sum(${registrations.status} = 'active'), 0)`,
      cancelledCount: sql<number>`coalesce(sum(${registrations.status} = 'cancelled'), 0)`,
      attendedCount: sql<number>`coalesce(sum(${registrations.status} = 'active' and ${registrations.attended} = true), 0)`
    }).from(registrations).where(where)
    const rows = await this.database.db.select({ registration: registrations, member: { memberId: members.id, avatarUrl: members.avatarUrl, displayName: members.displayName } })
      .from(registrations).innerJoin(members, eq(members.id, registrations.memberId))
      .where(and(where, query.status !== 'all' ? eq(registrations.status, query.status) : undefined))
      .orderBy(desc(registrations.currentRegisteredAt), desc(registrations.id)).limit(query.limit + 1).offset(query.offset)
    const page = rows.slice(0, query.limit)
    const answers = await answersForRegistrations(this.database.db, page.map(row => row.registration.id))
    return { total: Number(totals!.total), activeCount: Number(totals!.activeCount), cancelledCount: Number(totals!.cancelledCount),
      attendedCount: activity.lifecycle === 'cancelled' ? 0 : Number(totals!.attendedCount), hasMore: rows.length > query.limit,
      items: page.map(({ registration: row, member }) => ({
      id: row.id, activityId: row.activityId, status: row.status, contactPhone: row.contactPhone,
      currentRegisteredAt: row.currentRegisteredAt.toISOString(), cancelledAt: row.cancelledAt?.toISOString() ?? null,
      member, attended: activity.lifecycle !== 'cancelled' && row.status === 'active' && row.attended,
      attendedAt: activity.lifecycle !== 'cancelled' && row.status === 'active' && row.attended ? row.attendedAt?.toISOString() ?? null : null,
      answers: answers.get(row.id) ?? []
    })) }
  }

  notifications(header?: string, query: PageQuery = new PageQuery()) {
    return this.notificationQueries.list(header, query)
  }

  readNotification(id: string, header?: string) {
    return this.notificationQueries.read(id, header)
  }
}
