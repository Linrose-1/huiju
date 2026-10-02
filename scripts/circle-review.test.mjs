import assert from 'node:assert/strict'
import { URL } from 'node:url'
import { test } from 'node:test'
import { circleReviewOptions } from '../apps/api/scripts/circle-review-support.mjs'
const env={NODE_ENV:'development',DATABASE_URL:'mysql://test:fake@127.0.0.1:3306/huiju'}
test('circle review explicitly selects only the retained isolated database and two review ports',()=>{
  assert.equal(new URL(circleReviewOptions(env,['--circle-review']).url).pathname,'/huiju_circle_test_20260930')
  assert.equal(circleReviewOptions(env,['--circle-review','--actor=visitor']).port,3017)
  assert.equal(circleReviewOptions(env,['--circle-review','--actor=author']).port,3016)
})
test('circle review refuses production, implicit use, remote targets and arbitrary actors',()=>{
  for(const [config,args] of [[{...env,NODE_ENV:'production'},['--circle-review']],[env,[]],[{...env,DATABASE_URL:'mysql://test:fake@192.0.2.1:3306/huiju'},['--circle-review']],[{...env,DATABASE_URL:'mysql://test:fake@127.0.0.1:3306/production'},['--circle-review']],[env,['--circle-review','--actor=other']]]) assert.throws(()=>circleReviewOptions(config,args))
})
