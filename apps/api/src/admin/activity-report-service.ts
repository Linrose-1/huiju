import { Injectable } from '@nestjs/common'
import { and, avg, count, countDistinct, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { activities, activityOperations, registrationQuestions } from '../database/schema/activities.js'
import { readingEvents, readingVisitors } from '../database/schema/interactions.js'
import { activityReviews } from '../database/schema/feedback.js'
import { adminAccounts, members } from '../database/schema/members.js'
import { registrationAnswers, registrations } from '../database/schema/registrations.js'
import { fail } from '../flow/common.js'
import type { AdminTransaction } from './service.js'
import type { ActivityRegistrationListDto, ActivityRegistrationQuery, ActivityReportDto } from './activity-report-dto.js'

@Injectable()
export class ActivityReportService {
  async history(tx: AdminTransaction, id: string, offset: number) {
    await this.activity(tx,id)
    const rows = await tx.select({ operation: activityOperations, actorName: sql<string | null>`coalesce(${adminAccounts.displayName},${members.displayName})` })
      .from(activityOperations).leftJoin(adminAccounts,eq(adminAccounts.id,activityOperations.actorAdminAccountId))
      .leftJoin(members,eq(members.id,activityOperations.actorMemberId)).where(eq(activityOperations.activityId,id))
      .orderBy(desc(activityOperations.createdAt),desc(activityOperations.id)).limit(21).offset(offset)
    return { hasMore: rows.length>20,items:rows.slice(0,20).map(({ operation:r,actorName })=>({ id:r.id,action:r.action,actorName,reason:r.reason,createdAt:r.createdAt.toISOString() })) }
  }
  private async activity(tx: AdminTransaction, id: string) {
    const [activity] = await tx.select().from(activities).where(eq(activities.id,id)).limit(1)
    if (!activity) fail('NOT_FOUND','活动不存在',404)
    return activity
  }
  async report(tx: AdminTransaction, id: string): Promise<ActivityReportDto> {
    const activity = await this.activity(tx,id)
    const [reading] = await tx.select({ views: count(), visitors: countDistinct(sql`coalesce(concat('member:',${readingVisitors.memberId}),concat('visitor:',${readingVisitors.visitorHash}))`) })
      .from(readingEvents).innerJoin(readingVisitors,eq(readingVisitors.visitorHash,readingEvents.visitorHash)).where(eq(readingEvents.activityId,id))
    const [attendance] = await tx.select({ total: count() }).from(registrations).where(and(eq(registrations.activityId,id),eq(registrations.status,'active'),eq(registrations.attended,true)))
    const [reviews] = await tx.select({ total: count(), average: avg(activityReviews.score) }).from(activityReviews)
      .where(and(eq(activityReviews.activityId,id),isNull(activityReviews.deletedAt),isNull(activityReviews.hiddenAt)))
    return { id,title: activity.title,consultationContact: activity.consultationContact,views: reading!.views,visitors: reading!.visitors,
      activeRegistrations: activity.activeRegistrationCount, attendedMembers: activity.lifecycle==='cancelled' ? 0 : attendance!.total,
      conversionRate: reading!.visitors ? Math.round(activity.activeRegistrationCount/reading!.visitors*10000)/100 : null,
      reviewCount: reviews!.total, averageScore: reviews!.average===null ? null : Math.round(Number(reviews!.average)*100)/100 }
  }
  async registrations(tx: AdminTransaction,id: string,query: ActivityRegistrationQuery): Promise<ActivityRegistrationListDto> {
    await this.activity(tx,id)
    const where = and(eq(registrations.activityId,id),query.status==='all' ? undefined : eq(registrations.status,query.status as 'active'|'cancelled'))
    const [total] = await tx.select({ value: count() }).from(registrations).where(where)
    const rows = await tx.select({ registration: registrations, memberNumber: members.memberNumber,displayName: members.displayName })
      .from(registrations).innerJoin(members,eq(members.id,registrations.memberId)).where(where)
      .orderBy(desc(registrations.currentRegisteredAt),desc(registrations.id)).limit(40).offset(query.offset)
    const answers = rows.length ? await tx.select({ registrationId: registrationAnswers.registrationId, questionId: registrationQuestions.id,
      prompt: registrationQuestions.prompt,type: registrationQuestions.type,answer: registrationAnswers.answer })
      .from(registrationAnswers).innerJoin(registrationQuestions,eq(registrationQuestions.id,registrationAnswers.questionId))
      .where(inArray(registrationAnswers.registrationId,rows.map(row=>row.registration.id))).orderBy(registrationQuestions.sortOrder) : []
    return { items: rows.map(({ registration: r,...member })=>({ id:r.id,memberId:r.memberId,...member,status:r.status,contactPhone:r.contactPhone,
      registeredAt:r.currentRegisteredAt.toISOString(),cancelledAt:r.cancelledAt?.toISOString()??null,attended:r.attended,attendedAt:r.attendedAt?.toISOString()??null,
      answers:answers.filter(answer=>answer.registrationId===r.id).map(answer=>({ questionId:answer.questionId,prompt:answer.prompt,type:answer.type,answer:answer.answer })) })),total:total!.value,hasMore:query.offset+rows.length<total!.value }
  }
}
