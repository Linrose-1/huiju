import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { posterSourceHash } from '../../../apps/api/dist/flow/poster-service.js'

const content = JSON.parse(await readFile(new URL('./content.json', import.meta.url), 'utf8'))
const hour = 3_600_000
const day = 24 * hour
const travel = ['公共交通', '骑行或步行', '自行驾车']
const discussion = ['现场交流', '小组练习', '资料互换']
const comments = [
  '我会带一份去掉顾客姓名的记录，方便大家一起看。',
  '已记下集合位置，会提前十分钟到。',
  '能把讨论后的清单发给同桌伙伴就太好了。'
]
const reviews = [
  '把一句回访邀请念给同桌听，才发现原先的说法太像群发消息。回店后已经改了第一句。',
  '绕到库房后门看过一次，才明白平面图上两条看似相近的动线差在哪里。',
  '用白卡纸试拍了两组，釉面的反光变化很明显，回去能自己再搭一遍。',
  '把试做和剩料拆成两栏之后，每天打烊时记录快多了。'
]

function beijingStart(now, offset, localHour) {
  const local = new Date(Number(now) + 8 * hour)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + offset, localHour - 8))
}

export const batchActivityId = 'fc5ec79e-18e0-4014-99c5-16632e29cc30'

export async function populate({ c, actors, now, media }) {
  const insert = (table, values) => c.query('INSERT INTO ' + c.escapeId(table) + ' SET ?', values)
  const visitors = new Map()
  for (const actor of actors) {
    const visitor = createHash('sha256').update(randomUUID()).digest('hex')
    visitors.set(actor.id, visitor)
    await insert('reading_visitors', { visitor_hash: visitor, member_id: actor.id })
  }

  for (const [index, event] of content.gatherings.entries()) {
    const activity = index === 0 ? batchActivityId : randomUUID()
    const host = actors[event.host]
    const start = beijingStart(now, event.offset, event.hour)
    const end = new Date(+start + event.minutes * 60_000)
    const published = new Date(Math.min(Number(now) - (2 + index % 4) * day, +start - 5 * day))
    const cover = await media.cover(host.id, event.asset)
    const pictures = [cover]
    if (index === 0) {
      pictures.push(await media.cover(host.id, 'meeting'), await media.cover(host.id, 'office'))
    }
    const fee = event.cents ? 'paid' : 'free'
    const participants = actors.filter((actor, position) =>
      actor.id !== host.id && (position < 2 || (position + index) % 4 !== 0))
    await insert('activities', {
      id: activity, organizer_member_id: host.id, title: event.title, description: event.description,
      audience_types: JSON.stringify(index % 2 ? ['member', 'friend'] : ['all']),
      host_organization: '学加社群', organizing_organization: event.venue,
      sponsor_organization: index === 0 ? '里巷商友会' : null,
      registration_notice: '请提前十分钟到达集合点。如行程有变，请及时更新报名。',
      cover_url: cover, image_urls: JSON.stringify(pictures), location: event.location,
      consultation_contact: '集合或活动安排有疑问，可在活动留言区联系发起人。',
      starts_at: start, ends_at: end, registration_deadline: start, capacity: event.capacity,
      active_registration_count: participants.length,
      has_registration_ever: 1, fee_type: fee, fee_amount_cents: event.cents || null,
      lifecycle: 'published', published_at: published, created_at: published, updated_at: published
    })
    await insert('activity_operations', {
      id: randomUUID(), activity_id: activity, actor_type: 'member', actor_member_id: host.id,
      action: 'publish', created_at: published
    })
    await insert('activity_poster_copies', {
      activity_id: activity, subtitle: event.subtitle, highlights: JSON.stringify(event.highlights),
      version: 1, confirmed_by: host.id, confirmed_at: published,
      source_hash: posterSourceHash({ title: event.title, description: event.description, coverUrl: cover,
        startsAt: start, endsAt: end, location: event.location, feeType: fee, feeAmountCents: event.cents || null })
    })
    const questions = [
      { id: randomUUID(), type: 'single', prompt: '你会如何到达集合点？', options: travel },
      { id: randomUUID(), type: 'multiple', prompt: '你希望参加哪些交流环节？', options: discussion }
    ]
    for (const [order, q] of questions.entries()) {
      await insert('registration_questions', {
        id: q.id, activity_id: activity, type: q.type, prompt: q.prompt, options: JSON.stringify(q.options),
        required: order === 0, public_to_participants: order === 1, sort_order: order,
        created_at: published, updated_at: published
      })
    }
    const readers = actors.filter(actor => actor.id !== host.id)
    for (const [position, reader] of readers.entries()) {
      await insert('reading_events', {
        id: randomUUID(), activity_id: activity, visitor_hash: visitors.get(reader.id),
        recorded_at: new Date(+published + (position + 1) * 60_000)
      })
    }
    let reviewAdded = false
    for (const [position, actor] of participants.entries()) {
      const registration = randomUUID()
      const joined = new Date(+published + (position + 1) * hour)
      const attended = event.offset < 0 && (actors.indexOf(actor) < 2 || (position + index) % 5 !== 0)
      await insert('registrations', {
        id: registration, activity_id: activity, member_id: actor.id, status: 'active',
        contact_phone: actor.phone, first_registered_at: joined, current_registered_at: joined,
        attended, attended_at: attended ? start : null, attendance_marked_by_member_id: attended ? host.id : null,
        created_at: joined, updated_at: attended ? start : joined
      })
      await insert('registration_operations', {
        id: randomUUID(), registration_id: registration, actor_member_id: actor.id, action: 'registered', created_at: joined
      })
      const answers = [travel[position % travel.length], [discussion[position % 3], discussion[(position + 1) % 3]]]
      for (const [order, q] of questions.entries()) {
        await insert('registration_answers', {
          id: randomUUID(), registration_id: registration, question_id: q.id,
          answer: JSON.stringify(answers[order]), created_at: joined, updated_at: joined
        })
      }
      if (actors.indexOf(actor) >= 2 && !reviewAdded) {
        if (attended) {
          const when = new Date(+end + hour)
          await insert('activity_reviews', { id: randomUUID(), activity_id: activity, member_id: actor.id,
            content: reviews[index - 6], score: 5, created_at: when, updated_at: when })
          reviewAdded = true
        } else if (event.offset > 0) {
          await insert('activity_comments', { id: randomUUID(), activity_id: activity, member_id: actor.id,
            content: comments[index % comments.length], created_at: joined, updated_at: joined })
          reviewAdded = true
        }
      }
    }
  }

  for (const [index, post] of content.posts.entries()) {
    const postId = randomUUID()
    const author = actors[post.author]
    const published = new Date(Number(now) - (2 + index) * hour)
    await insert('circle_posts', {
      id: postId, author_id: author.id, request_id: randomUUID(), category: post.category, subtype: post.subtype,
      title: post.title, body: post.body, location: post.location, ...post.details,
      created_at: published, updated_at: published
    })
    const image = await media.circle(post.asset)
    await insert('circle_images', { ...image, owner_id: author.id, created_at: published })
    await insert('circle_post_images', { id: randomUUID(), post_id: postId, image_id: image.id, position: 0 })
    const readers = actors.filter(actor => actor.id !== author.id).slice(0, 4 + index % 6)
    for (const [position, reader] of readers.entries()) {
      const when = new Date(+published + (position + 1) * 60_000)
      await insert('circle_post_read_events', { id: randomUUID(), post_id: postId, member_id: reader.id, recorded_at: when })
      if (position === readers.length - 1) {
        await insert('circle_intents', { id: randomUUID(), post_id: postId, member_id: reader.id,
          request_id: randomUUID(), phone: reader.phone, created_at: when })
      }
    }
  }
}
