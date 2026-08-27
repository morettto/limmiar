import { describe, expect, it, vi } from 'vitest'
import { criarSegmentStore } from './segment-store'
import type { TranscriptionSegment } from '@limmiar/audio'

const SEG_A: TranscriptionSegment = { startMs: 0, endMs: 320, text: 'ola' }
const SEG_B: TranscriptionSegment = { startMs: 320, endMs: 640, text: 'mundo' }

describe('criarSegmentStore', () => {
  it('getSnapshot starts empty', () => {
    const store = criarSegmentStore()

    expect(store.getSnapshot()).toEqual([])
  })

  it('acrescentar appends to the snapshot, in order', () => {
    const store = criarSegmentStore()

    store.acrescentar([SEG_A])
    store.acrescentar([SEG_B])

    expect(store.getSnapshot()).toEqual([SEG_A, SEG_B])
  })

  it('getSnapshot returns the same reference across calls with no append in between', () => {
    const store = criarSegmentStore()
    store.acrescentar([SEG_A])

    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it('getSnapshot returns a new reference after a real append', () => {
    const store = criarSegmentStore()
    const before = store.getSnapshot()

    store.acrescentar([SEG_A])

    expect(store.getSnapshot()).not.toBe(before)
  })

  it('notifies subscribers on a real append', () => {
    const store = criarSegmentStore()
    const aoMudar = vi.fn()
    store.subscribe(aoMudar)

    store.acrescentar([SEG_A])

    expect(aoMudar).toHaveBeenCalledOnce()
  })

  it('an empty batch does not notify and does not change the snapshot reference', () => {
    const store = criarSegmentStore()
    const aoMudar = vi.fn()
    store.subscribe(aoMudar)
    const before = store.getSnapshot()

    store.acrescentar([])

    expect(aoMudar).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toBe(before)
  })

  it('unsubscribe stops further notifications', () => {
    const store = criarSegmentStore()
    const aoMudar = vi.fn()
    const unsubscribe = store.subscribe(aoMudar)

    unsubscribe()
    store.acrescentar([SEG_A])

    expect(aoMudar).not.toHaveBeenCalled()
  })

  it('notifies every subscriber, independently', () => {
    const store = criarSegmentStore()
    const primeiro = vi.fn()
    const segundo = vi.fn()
    store.subscribe(primeiro)
    const unsubscribeSegundo = store.subscribe(segundo)
    unsubscribeSegundo()

    store.acrescentar([SEG_A])

    expect(primeiro).toHaveBeenCalledOnce()
    expect(segundo).not.toHaveBeenCalled()
  })
})
