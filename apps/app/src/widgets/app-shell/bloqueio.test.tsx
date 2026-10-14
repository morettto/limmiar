import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { BloqueioContext, useBloquearNavegacao } from './bloqueio'

function montar(ativo: boolean) {
  const setBloqueios = vi.fn()
  const hook = renderHook(({ ativo }) => useBloquearNavegacao(ativo), {
    initialProps: { ativo },
    wrapper: ({ children }: { children: ReactNode }) => <BloqueioContext.Provider value={setBloqueios}>{children}</BloqueioContext.Provider>,
  })
  const aplicar = (chamada: number, total: number) => (setBloqueios.mock.calls[chamada]![0] as (total: number) => number)(total)
  return { ...hook, setBloqueios, aplicar }
}

describe('useBloquearNavegacao', () => {
  it('soma um enquanto ativo e devolve ao sair, sem tocar no contador de outras páginas', () => {
    const { setBloqueios, aplicar, unmount } = montar(true)
    expect(setBloqueios).toHaveBeenCalledTimes(1)
    expect(aplicar(0, 1)).toBe(2)
    unmount()
    expect(setBloqueios).toHaveBeenCalledTimes(2)
    expect(aplicar(1, 2)).toBe(1)
  })

  it('não bloqueia enquanto inativo e acompanha a mudança do estado', () => {
    const { setBloqueios, rerender } = montar(false)
    expect(setBloqueios).not.toHaveBeenCalled()
    rerender({ ativo: true })
    expect(setBloqueios).toHaveBeenCalledTimes(1)
    rerender({ ativo: false })
    expect(setBloqueios).toHaveBeenCalledTimes(2)
  })

  it('recusa uso fora do AppShell', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useBloquearNavegacao(true))).toThrow('nenhum <AppShell> ancestral')
    vi.restoreAllMocks()
  })
})
