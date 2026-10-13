import { describe, expect, it, vi } from 'vitest'
import { CapacidadeEsgotada, criarPoolUpstream } from './pool.ts'
import type { AbrirUpstream, Upstream } from './upstream.ts'

function instancia(falha = false) {
  const fechar = vi.fn()
  let aoFechar!: (erro: Error) => void
  const abrir = vi.fn<AbrirUpstream>(async (_idioma, _msg, quandoFechar) => {
    if (falha) throw new Error('recusou')
    aoFechar = quandoFechar
    return { enviar: vi.fn(), confirmar: vi.fn(), fechar } satisfies Upstream
  })
  return { abrir, fechar, cair: (erro: Error) => aoFechar(erro) }
}

describe('pool de upstreams', () => {
  it('distribui pela instância menos ocupada e recusa quando todas estão cheias', async () => {
    const a = instancia(); const b = instancia()
    const pool = criarPoolUpstream([a.abrir, b.abrir], 1)
    const primeira = await pool('pt', vi.fn(), vi.fn())
    await pool('pt', vi.fn(), vi.fn())
    expect(a.abrir).toHaveBeenCalledOnce(); expect(b.abrir).toHaveBeenCalledOnce()
    await expect(pool('pt', vi.fn(), vi.fn())).rejects.toBeInstanceOf(CapacidadeEsgotada)
    primeira.fechar(); primeira.fechar()
    expect(a.fechar).toHaveBeenCalledTimes(2)
    await pool('pt', vi.fn(), vi.fn())
    expect(a.abrir).toHaveBeenCalledTimes(2)
  })

  it('libera a vaga quando o upstream cai e avisa a sessão', async () => {
    const a = instancia()
    const pool = criarPoolUpstream([a.abrir], 1)
    const aoFechar = vi.fn()
    await pool('pt', vi.fn(), aoFechar)
    a.cair(new Error('caiu'))
    expect(aoFechar).toHaveBeenCalledWith(new Error('caiu'))
    await expect(pool('pt', vi.fn(), vi.fn())).resolves.toBeDefined()
  })

  it('tenta a próxima instância se uma recusar e propaga o último erro se todas recusarem', async () => {
    const ruim = instancia(true); const boa = instancia()
    await expect(criarPoolUpstream([ruim.abrir, boa.abrir], 2)('pt', vi.fn(), vi.fn())).resolves.toBeDefined()
    expect(boa.abrir).toHaveBeenCalledOnce()
    await expect(criarPoolUpstream([instancia(true).abrir], 2)('pt', vi.fn(), vi.fn())).rejects.toThrow('recusou')
  })
})
