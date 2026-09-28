import { describe, expect, it } from 'vitest'
import { contrastRatio, LAMP, OUTLINE, SCREEN, SIGN } from './colors'

describe('stage 3 visual contract', () => {
  it('keeps both sign text colors above WCAG AA 4.5:1', () => {
    expect(contrastRatio(OUTLINE, SIGN.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(SIGN.role, SIGN.bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('preserves the specified screen and lamp palette', () => {
    expect(SCREEN).toEqual({ run: '#4cb8ff', done: '#52e07a', blocked: '#8c1616', wait: '#1d2532' })
    expect(LAMP).toEqual({ run: '#2f86e0', done: '#2f9e4f', blocked: '#c8322a', wait: '#77705f' })
  })
})
