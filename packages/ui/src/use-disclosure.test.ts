import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useDisclosure } from './use-disclosure'

describe('useDisclosure', () => {
  it('starts closed', () => {
    const { result } = renderHook(() => useDisclosure())
    expect(result.current.isOpen).toBe(false)
    expect(result.current.triggerProps['aria-expanded']).toBe(false)
  })

  it('toggles open when the trigger is activated', () => {
    const { result } = renderHook(() => useDisclosure())

    act(() => {
      result.current.triggerProps.onClick()
    })
    expect(result.current.isOpen).toBe(true)
    expect(result.current.triggerProps['aria-expanded']).toBe(true)

    act(() => {
      result.current.triggerProps.onClick()
    })
    expect(result.current.isOpen).toBe(false)
    expect(result.current.triggerProps['aria-expanded']).toBe(false)
  })

  it('exposes a stable id shared between aria-controls and the disclosed content', () => {
    const { result } = renderHook(() => useDisclosure())
    expect(result.current.id).toBeTruthy()
    expect(result.current.triggerProps['aria-controls']).toBe(result.current.id)
  })

  it('sets the trigger type to "button" so it never accidentally submits a form', () => {
    const { result } = renderHook(() => useDisclosure())
    expect(result.current.triggerProps.type).toBe('button')
  })

  it('gives each hook instance its own independent id', () => {
    const { result: a } = renderHook(() => useDisclosure())
    const { result: b } = renderHook(() => useDisclosure())
    expect(a.current.id).not.toBe(b.current.id)
  })
})
