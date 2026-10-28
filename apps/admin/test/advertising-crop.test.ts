import { describe, expect, it } from 'vitest'
import { centeredCrop, cropRect, validateImage } from '../src/modules/advertising/crop'
describe('fixed-ratio advertising crop', () => {
  it('fits a tall photo into a wide crop without changing source pixels', () => {
    const rect = cropRect(centeredCrop(900, 1800, 3))
    expect(rect).toEqual({ x: 0, y: 750, width: 900, height: 300 })
    expect(rect.width / rect.height).toBe(3)
  })
  it('keeps zoomed and dragged crops inside the image at both ratios', () => {
    for (const ratio of [2, 3]) {
      const rect = cropRect({ width: 2400, height: 1200, ratio, zoom: 2, x: -9999, y: 9999 })
      expect(rect.x).toBe(0)
      expect(rect.y + rect.height).toBe(1200)
      expect(rect.width / rect.height).toBe(ratio)
    }
  })
  it('rejects non-image formats and large uploads before reading', () => {
    expect(() => validateImage({ type: 'image/svg+xml', size: 10 })).toThrow('PNG')
    expect(() => validateImage({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toThrow('5 MB')
    expect(() => validateImage({ type: 'image/jpeg', size: 5 * 1024 * 1024 })).not.toThrow()
  })
})
