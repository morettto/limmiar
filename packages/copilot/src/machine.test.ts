import { createActor } from 'xstate'
import { describe, expect, it } from 'vitest'
import { criarMaquinaRascunho } from './machine.ts'
import type { Afirmacao } from './types.ts'

const ancorada = (texto: string): Afirmacao => ({ texto, ancoras: [{ inicioMs: 0, fimMs: 100 }] })
const semAncora = (texto: string): Afirmacao => ({ texto, ancoras: [] })

describe('criarMaquinaRascunho', () => {
  it('teste adversário: GERADO com mistura de afirmações filtra as sem âncora', () => {
    const actor = createActor(criarMaquinaRascunho({ id: 'r1' })).start()
    actor.send({
      type: 'GERADO',
      afirmacoes: [ancorada('a'), semAncora('b'), ancorada('c'), semAncora('d')],
      agora: '2026-01-01T00:00:00.000Z',
    })

    expect(actor.getSnapshot().context.afirmacoes).toEqual([ancorada('a'), ancorada('c')])
    expect(actor.getSnapshot().context.afirmacoesDescartadasSemAncora).toBe(2)
    expect(actor.getSnapshot().context.criadaEm).toBe('2026-01-01T00:00:00.000Z')
    expect(actor.getSnapshot().matches('rascunho')).toBe(true)
  })

  it('GERADO com todas as afirmações âncoradas: nenhuma descartada', () => {
    const actor = createActor(criarMaquinaRascunho({ id: 'r1' })).start()
    actor.send({ type: 'GERADO', afirmacoes: [ancorada('a'), ancorada('b')], agora: '2026-01-01T00:00:00.000Z' })

    expect(actor.getSnapshot().context.afirmacoes).toEqual([ancorada('a'), ancorada('b')])
    expect(actor.getSnapshot().context.afirmacoesDescartadasSemAncora).toBe(0)
  })

  it('GERADO com todas as afirmações sem âncora: todas descartadas', () => {
    const actor = createActor(criarMaquinaRascunho({ id: 'r1' })).start()
    actor.send({ type: 'GERADO', afirmacoes: [semAncora('a'), semAncora('b')], agora: '2026-01-01T00:00:00.000Z' })

    expect(actor.getSnapshot().context.afirmacoes).toEqual([])
    expect(actor.getSnapshot().context.afirmacoesDescartadasSemAncora).toBe(2)
  })

  it('GERADO com lista vazia: nenhuma mantida, nenhuma descartada', () => {
    const actor = createActor(criarMaquinaRascunho({ id: 'r1' })).start()
    actor.send({ type: 'GERADO', afirmacoes: [], agora: '2026-01-01T00:00:00.000Z' })

    expect(actor.getSnapshot().context.afirmacoes).toEqual([])
    expect(actor.getSnapshot().context.afirmacoesDescartadasSemAncora).toBe(0)
  })

  it('GERADO sem agora explícito cai para o relógio real (ISO válido)', () => {
    const actor = createActor(criarMaquinaRascunho({ id: 'r1' })).start()
    actor.send({ type: 'GERADO', afirmacoes: [ancorada('a')] })

    const { criadaEm } = actor.getSnapshot().context
    expect(criadaEm).not.toBeNull()
    expect(new Date(criadaEm as string).toISOString()).toBe(criadaEm)
  })

  it('caminho gerando → rascunho → aprovado', () => {
    const actor = createActor(criarMaquinaRascunho({ id: 'r1' })).start()
    actor.send({ type: 'GERADO', afirmacoes: [ancorada('a')], agora: '2026-01-01T00:00:00.000Z' })
    actor.send({ type: 'APROVAR' })

    expect(actor.getSnapshot().matches('aprovado')).toBe(true)
    // `aprovado` é `{ type: 'final' }` — status 'done' prova isso, não só o
    // nome do nó (mata os mutantes que apagam esse `type: 'final'`).
    expect(actor.getSnapshot().status).toBe('done')
  })

  it('caminho gerando → rascunho → descartado (descarte direto)', () => {
    const actor = createActor(criarMaquinaRascunho({ id: 'r1' })).start()
    actor.send({ type: 'GERADO', afirmacoes: [ancorada('a')], agora: '2026-01-01T00:00:00.000Z' })
    actor.send({ type: 'DESCARTAR' })

    expect(actor.getSnapshot().matches('descartado')).toBe(true)
    expect(actor.getSnapshot().status).toBe('done')
  })

  it('caminho gerando → rascunho → aVencer → aprovado', () => {
    const actor = createActor(criarMaquinaRascunho({ id: 'r1' })).start()
    actor.send({ type: 'GERADO', afirmacoes: [ancorada('a')], agora: '2026-01-01T00:00:00.000Z' })
    actor.send({ type: 'AVISO_VENCIMENTO', agora: '2026-01-24T00:00:00.000Z' })
    actor.send({ type: 'APROVAR' })

    expect(actor.getSnapshot().matches('aprovado')).toBe(true)
    expect(actor.getSnapshot().status).toBe('done')
  })

  it('caminho gerando → rascunho → aVencer → descartado via VENCEU', () => {
    const actor = createActor(criarMaquinaRascunho({ id: 'r1' })).start()
    actor.send({ type: 'GERADO', afirmacoes: [ancorada('a')], agora: '2026-01-01T00:00:00.000Z' })
    actor.send({ type: 'AVISO_VENCIMENTO', agora: '2026-01-24T00:00:00.000Z' })
    actor.send({ type: 'VENCEU' })

    expect(actor.getSnapshot().matches('descartado')).toBe(true)
    expect(actor.getSnapshot().status).toBe('done')
  })

  it('caminho gerando → rascunho → aVencer → descartado via DESCARTAR', () => {
    const actor = createActor(criarMaquinaRascunho({ id: 'r1' })).start()
    actor.send({ type: 'GERADO', afirmacoes: [ancorada('a')], agora: '2026-01-01T00:00:00.000Z' })
    actor.send({ type: 'AVISO_VENCIMENTO', agora: '2026-01-24T00:00:00.000Z' })
    actor.send({ type: 'DESCARTAR' })

    expect(actor.getSnapshot().matches('descartado')).toBe(true)
  })

  it('avisoEmitidoEm fica gravado ao entrar em aVencer, com agora explícito', () => {
    const actor = createActor(criarMaquinaRascunho({ id: 'r1' })).start()
    actor.send({ type: 'GERADO', afirmacoes: [ancorada('a')], agora: '2026-01-01T00:00:00.000Z' })
    actor.send({ type: 'AVISO_VENCIMENTO', agora: '2026-01-24T00:00:00.000Z' })

    expect(actor.getSnapshot().context.avisoEmitidoEm).toBe('2026-01-24T00:00:00.000Z')
  })

  it('AVISO_VENCIMENTO sem agora explícito cai para o relógio real (ISO válido)', () => {
    const actor = createActor(criarMaquinaRascunho({ id: 'r1' })).start()
    actor.send({ type: 'GERADO', afirmacoes: [ancorada('a')], agora: '2026-01-01T00:00:00.000Z' })
    actor.send({ type: 'AVISO_VENCIMENTO' })

    const { avisoEmitidoEm } = actor.getSnapshot().context
    expect(avisoEmitidoEm).not.toBeNull()
    expect(new Date(avisoEmitidoEm as string).toISOString()).toBe(avisoEmitidoEm)
  })

  it('contexto inicial parte de gerando com afirmacoes vazias e criadaEm nulo', () => {
    const maquina = criarMaquinaRascunho({ id: 'r1' })
    expect(maquina.id).toBe('rascunho')

    const actor = createActor(maquina).start()
    const { context } = actor.getSnapshot()

    expect(actor.getSnapshot().matches('gerando')).toBe(true)
    expect(context).toEqual({
      id: 'r1',
      criadaEm: null,
      afirmacoes: [],
      afirmacoesDescartadasSemAncora: 0,
      avisoEmitidoEm: null,
    })
  })
})
