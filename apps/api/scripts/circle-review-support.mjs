import { URL } from 'node:url'
export function circleReviewOptions(env,args) {
  if(env.NODE_ENV !== 'development' || !args.includes('--circle-review')) throw new Error('Circle review requires explicit development --circle-review')
  const source=new URL(env.DATABASE_URL || 'invalid:')
  if(source.protocol!=='mysql:' || source.hostname!=='127.0.0.1' || source.port!=='3306' || source.pathname!=='/huiju' || source.search) throw new Error('Only the authorized local source configuration is supported')
  const actor=args.find(x=>x.startsWith('--actor='))?.slice(8) || 'author'
  if(!['author','visitor'].includes(actor)) throw new Error('Review actor must be author or visitor')
  source.pathname='/huiju_circle_test_20260930'
  return {url:source.href,actor,port:actor==='author'?3016:3017}
}
