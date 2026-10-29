import assert from 'node:assert/strict'
import { test } from 'node:test'
import images from './activity-images-fixture.mjs'
const { activityImages, imageSlotsPayload, cropGeometry } = images
test('legacy single cover reads without mutation; ordered collection wins', () => {
  assert.deepEqual(activityImages({ coverUrl: '/legacy.jpg' }), ['/legacy.jpg'])
  assert.deepEqual(activityImages({ coverUrl: null }), [])
  assert.deepEqual(activityImages({ coverUrl: '/a', imageUrls: ['/a','/b','/c'] }), ['/a','/b','/c'])
})
test('removing cover never promotes an extra image and prevents invalid save', () => {
  assert.throws(() => imageSlotsPayload(['','/b','/c']), /封面/)
  assert.deepEqual(imageSlotsPayload(['/a','','/c']), ['/a','/c'])
  assert.deepEqual(imageSlotsPayload(['','','']), [])
  assert.throws(() => imageSlotsPayload(['/a','/b','/c','/d']), /3/)
})
test('crop always covers 5:4 frame, bounds dragging and maps to source pixels', () => {
  for (const [width,height] of [[1200,2000],[2000,600],[1250,1000]]) {
    for (const zoom of [1,2,4]) {
      for (const [x,y] of [[undefined,undefined],[-10000,-10000],[10000,10000]]) {
        const g = cropGeometry(width,height,350,zoom,x,y)
        assert.ok(g.width >= 350 && g.height >= 280)
        assert.ok(g.sourceX >= 0 && g.sourceY >= 0)
        assert.ok(g.sourceX + g.sourceWidth <= width + 1e-8)
        assert.ok(g.sourceY + g.sourceHeight <= height + 1e-8)
        assert.ok(Math.abs(g.sourceWidth/g.sourceHeight-1.25)<1e-8)
      }
    }
  }
})
