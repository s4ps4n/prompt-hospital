import { describe, expect, it } from 'vitest'
import { initialJournal } from '../journal/initial'
import { decideDrop } from './dnd'

const j = initialJournal()

describe('decideDrop', () => {
  it('мимо всех целей — miss', () => {
    expect(decideDrop(j, 'T-12', null)).toEqual({ kind: 'miss' })
    expect(decideDrop(j, 'T-12', { drop: null, slot: null })).toEqual({ kind: 'miss' })
  })

  it('из лотка на модель — assign (свободна она или занята, решает операция)', () => {
    expect(decideDrop(j, 'T-12', { drop: 'w2', slot: null })).toEqual({ kind: 'op', op: { name: 'assign', args: { task: 'T-12', worker: 'w2' } } })
    expect(decideDrop(j, 'T-12', { drop: 'w1', slot: null })).toEqual({ kind: 'op', op: { name: 'assign', args: { task: 'T-12', worker: 'w1' } } })
  })

  it('с одной модели на другую — reassign; на ту же — ничего', () => {
    expect(decideDrop(j, 'T-08', { drop: 'w3', slot: null })).toEqual({
      kind: 'op',
      op: { name: 'reassign', args: { task: 'T-08', from: 'w1', to: 'w3' } },
    })
    expect(decideDrop(j, 'T-08', { drop: 'w1', slot: null })).toEqual({ kind: 'none' })
  })

  it('на лоток / кабинет Гермеса — unassign; неназначенная задача остаётся', () => {
    expect(decideDrop(j, 'T-08', { drop: 'queue', slot: null })).toEqual({ kind: 'op', op: { name: 'unassign', args: { task: 'T-08' } } })
    expect(decideDrop(j, 'T-12', { drop: 'queue', slot: null })).toEqual({ kind: 'none' })
  })

  it('на конверт в лотке — reorder, на самого себя — ничего', () => {
    expect(decideDrop(j, 'T-15', { drop: 'queue', slot: 'T-12' })).toEqual({ kind: 'op', op: { name: 'reorder', args: { task: 'T-15', before: 'T-12' } } })
    expect(decideDrop(j, 'T-12', { drop: 'queue', slot: 'T-12' })).toEqual({ kind: 'none' })
  })

  it('неизвестная задача — ничего', () => {
    expect(decideDrop(j, 'T-99', { drop: 'w2', slot: null })).toEqual({ kind: 'none' })
  })
})
