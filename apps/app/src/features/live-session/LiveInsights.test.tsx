import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import type { ComponentProps } from 'react'
import { FalhaServicoInsight } from '../../entities/insight/falha-insight'
import { consultarInsight, enviarVoto, type ResultadoInsight } from '../../entities/insight/insight'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { LiveInsights } from './LiveInsights'
import { guardarVoto, lerVotos } from '../../entities/insight/voto-store'
import { gravarConsentimento, lerConsentimento } from '../../entities/insight/consentimento-voto'
import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'

vi.mock('../../entities/insight/insight', () => ({ consultarInsight: vi.fn(), enviarVoto: vi.fn() }))
const consultar = vi.mocked(consultarInsight)
const enviar = vi.mocked(enviarVoto)
const bibliografia = { accountId: 'conta-4', accessToken: 'tok', materialIds: [] }
const props = { palavras: [{ texto: 'Tenho medo.', inicioMs: 0, fimMs: 1000, locutor: 's' }], papeis: { s: 'paciente' as const }, estavelAteMs: 1100, autorizada: true }
const fonte = { trecho_id: 't1', titulo: 'Livro', autor: 'Autor', pagina: 1, paragrafo: 2, citacao_literal: 'Citação literal.', fenomeno_na_fala: 'Medo', fenomeno_no_trecho: 'Medo', probabilidade: 0.995, nivel: 'forte' as const }
const possivel = { ...fonte, trecho_id: 't2', titulo: 'Artigo', probabilidade: 0.93, nivel: 'possivel' as const }
const resultado: ResultadoInsight = { cartoes: [fonte, possivel], alerta_risco: true, clarificar: true, completo: true, juiz: 'v7' }
function view(value: ComponentProps<typeof LiveInsights> = props) { return <I18nProvider i18n={i18n}><LiveInsights {...value} /></I18nProvider> }
beforeAll(async () => dynamicActivate('pt-BR'))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })
describe('insights durante a sessão', () => {
  it('seleciona a fonte escolhida com frase e tempos reais; abrir balão não aprova a nota', async () => {
    vi.useFakeTimers()
    consultar.mockResolvedValue(resultado)
    const onSelectFonte = vi.fn()
    render(view({ ...props, onSelectFonte }))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    fireEvent.click(screen.getByRole('button', { name: 'Tenho medo.' }))
    expect(onSelectFonte).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Usar na nota' })[1]!)
    expect(onSelectFonte).toHaveBeenCalledWith({ id: '0:s', frase: 'Tenho medo.', contexto: [] }, resultado.cartoes[1], 0, 1000)
  })
  it('analisa cada frase da trilha do paciente inteira apesar de falas simultâneas do profissional', async () => {
    vi.useFakeTimers()
    consultar.mockResolvedValue(resultado)
    render(view({ ...props, trilhasSeparadas: true, estavelAteMs: 2000, palavras: [
      { texto: 'Tenho', inicioMs: 0, fimMs: 100, locutor: 's' },
      { texto: 'Conte.', inicioMs: 50, fimMs: 140, locutor: 'p' },
      { texto: 'medo.', inicioMs: 100, fimMs: 200, locutor: 's' },
      { texto: 'Agora', inicioMs: 220, fimMs: 300, locutor: 's' },
      { texto: 'Continue.', inicioMs: 240, fimMs: 320, locutor: 'p' },
      { texto: 'não.', inicioMs: 300, fimMs: 500, locutor: 's' },
      { texto: 'Outra', inicioMs: 600, fimMs: 700, locutor: null },
    ], papeis: { s: 'paciente', p: 'voce' } }))
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(consultar.mock.calls.map(call => call[0]).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: '0:s', frase: 'Tenho medo.', contexto: [] },
      { id: '220:s', frase: 'Agora não.', contexto: ['Tenho medo.'] },
    ])
    expect(screen.getByRole('button', { name: 'Tenho medo.' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Agora não.' })).toBeTruthy()
    expect(screen.getByText('Conte.')).toBeTruthy(); expect(screen.getByText('Continue.')).toBeTruthy()
  })
  it('publica fontes antes do fim da sessão enquanto o paciente continua a próxima frase', async () => {
    vi.useFakeTimers()
    let publicar!: (r: ResultadoInsight) => void
    let concluir!: (r: ResultadoInsight) => void
    consultar.mockImplementationOnce((_consulta, _signal, atualizar) => {
      publicar = atualizar
      return new Promise((resolve) => { concluir = resolve })
    })
    const mounted = render(view())
    await act(async () => vi.advanceTimersByTimeAsync(500))
    mounted.rerender(view({ ...props, palavras: [...props.palavras, { texto: 'Quando', inicioMs: 1100, fimMs: 1300, locutor: 's' }], estavelAteMs: 1400 }))
    expect(consultar.mock.calls[0]![1].aborted).toBe(false)
    await act(async () => publicar(resultado))
    expect(screen.getByText('Livro')).toBeTruthy()
    expect(screen.getByText('Artigo')).toBeTruthy()
    expect(consultar).toHaveBeenCalledOnce()
    await act(async () => concluir(resultado))
  })
  it.each([
    { fenomeno_na_fala: '', fenomeno_no_trecho: '' },
    { fenomeno_na_fala: '', fenomeno_no_trecho: 'Medo' },
  ])('preserva a citação mesmo sem descrição adicional do fenômeno %#', async (fenomenos) => {
    vi.useFakeTimers()
    consultar.mockResolvedValue({ cartoes: [{ ...fonte, ...fenomenos }], alerta_risco: false, clarificar: false, completo: true, juiz: 'v7' })
    render(view())
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(screen.getByText('Citação literal.')).toBeTruthy()
    expect(screen.queryByText('—')).toBeNull()
  })
  it('mostra todas as fontes e retira imediatamente resultado de texto, papel ou contexto corrigido', async () => {
    vi.useFakeTimers()
    consultar.mockResolvedValue(resultado)
    const mounted = render(view())
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(screen.getByText('Livro')).toBeTruthy()
    expect(screen.getByText('Artigo')).toBeTruthy()
    expect(screen.getAllByText('Página 1, parágrafo 2')).toHaveLength(2)
    expect(screen.getByText('Esclareça o contexto desta fala com o paciente.')).toBeTruthy()
    mounted.rerender(view({ ...props, palavras: [{ ...props.palavras[0]!, texto: 'Não tenho medo.' }] }))
    expect(screen.queryByText('Livro')).toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(within(screen.getByRole('region', { name: 'Transcrição ao vivo' })).getByRole('button', { name: 'Não tenho medo.' })).toBeTruthy()
    mounted.rerender(view({ ...props, autorizada: false }))
    expect(screen.queryByText('Livro')).toBeNull()
    expect(consultar.mock.calls[0]![0]).toEqual({ id: '0:s', frase: 'Tenho medo.', contexto: [] })
  })
  describe('falhas do copiloto', () => {
    it('503: avisa que o copiloto não foi liberado, sem fabricar referências, e some quando a análise é retirada', async () => {
      vi.useFakeTimers()
      consultar.mockRejectedValue(new FalhaServicoInsight('nao_liberado'))
      const mounted = render(view({ ...props, autorizada: false }))
      await act(async () => vi.advanceTimersByTimeAsync(500))
      expect(consultar).not.toHaveBeenCalled()
      mounted.rerender(view())
      await act(async () => vi.advanceTimersByTimeAsync(500))
      expect(screen.getByRole('status').textContent).toBe('Copiloto não liberado. A transcrição segue normalmente, sem análise das falas.')
      expect(screen.queryByText(/^Fontes pertinentes/)).toBeNull()
      mounted.rerender(view({ ...props, autorizada: false }))
      expect(screen.queryByRole('status')).toBeNull()
    })
    it('rede ou prazo: avisa que o serviço está fora, tenta de novo sozinho e limpa o aviso quando volta', async () => {
      vi.useFakeTimers()
      consultar.mockRejectedValueOnce(new FalhaServicoInsight('fora')).mockResolvedValue(resultado)
      render(view())
      await act(async () => vi.advanceTimersByTimeAsync(500))
      expect(screen.getByRole('status').textContent).toBe('Serviço do copiloto fora do ar. Tentando de novo.')
      expect(screen.queryByText('Esta fala ficou sem análise.')).toBeNull()
      expect(screen.queryByText('Livro')).toBeNull()
      await act(async () => vi.advanceTimersByTimeAsync(1000))
      expect(consultar).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('status')).toBeNull()
      expect(screen.getByText('Livro')).toBeTruthy()
    })
    it('erro no stream: marca só esta fala como sem análise, sem aviso de serviço; corrigir o texto tira a marca', async () => {
      vi.useFakeTimers()
      consultar.mockRejectedValue(new Error('Resposta do copiloto inválida.'))
      const mounted = render(view({ ...props, palavras: [...props.palavras, { texto: 'Conte.', inicioMs: 1200, fimMs: 1400, locutor: 'p' }],
        papeis: { ...props.papeis, p: 'voce' }, estavelAteMs: 1500 }))
      await act(async () => vi.advanceTimersByTimeAsync(500))
      expect(screen.getByText('Tenho medo.').closest('li')!.textContent).toContain('Esta fala ficou sem análise.')
      expect(screen.getAllByText('Esta fala ficou sem análise.')).toHaveLength(1)
      expect(screen.queryByRole('status')).toBeNull()
      mounted.rerender(view({ ...props, palavras: [{ ...props.palavras[0]!, texto: 'Não tenho medo.' }] }))
      expect(screen.queryByText('Esta fala ficou sem análise.')).toBeNull()
    })
    it('falha só na análise da fala inteira não marca as frases já analisadas', async () => {
      vi.useFakeTimers()
      consultar.mockImplementation(async (consulta) => {
        if (consulta.ancoras) throw new Error('Resposta do copiloto inválida.')
        return resultado
      })
      render(view({ ...props, estavelAteMs: 3000, papeis: { s: 'paciente', p: 'voce' }, palavras: [
        { texto: 'Tenho', inicioMs: 0, fimMs: 500, locutor: 's' }, { texto: 'medo.', inicioMs: 500, fimMs: 1000, locutor: 's' },
        { texto: 'Não', inicioMs: 1100, fimMs: 1500, locutor: 's' }, { texto: 'durmo.', inicioMs: 1500, fimMs: 2000, locutor: 's' },
        { texto: 'Conte.', inicioMs: 2100, fimMs: 2500, locutor: 'p' },
      ] }))
      await act(async () => vi.advanceTimersByTimeAsync(1500))
      expect(consultar.mock.calls.some(([consulta]) => consulta.ancoras)).toBe(true)
      expect(screen.queryByText('Esta fala ficou sem análise.')).toBeNull()
      expect(screen.getByRole('button', { name: 'Tenho medo.' })).toBeTruthy()
    })
  })
  it('recebe silêncio contextual válido sem exibir referência ou alerta inventado', async () => {
    vi.useFakeTimers()
    consultar.mockResolvedValue({ cartoes: [], alerta_risco: false, clarificar: false, completo: true, juiz: 'v7' })
    render(view())
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(screen.getByText('Tenho medo.')).toBeTruthy()
    expect(screen.queryByText(/^Fontes pertinentes/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tenho medo.' })).toBeNull()
  })
  it('clique e retorno ligam a fala ao balão com todas as fontes sem esconder a próxima hipótese', async () => {
    vi.useFakeTimers()
    consultar.mockResolvedValue(resultado)
    const palavras = [{ texto: 'Como está?', inicioMs: 0, fimMs: 100, locutor: 'p' },
      { texto: 'Tenho medo.', inicioMs: 200, fimMs: 1000, locutor: 's' },
      { texto: 'Agora', inicioMs: 1500, fimMs: 1700, locutor: 's' },
      { texto: 'Uma voz', inicioMs: 1800, fimMs: 2000, locutor: null }]
    render(view({ ...props, palavras, papeis: { ...props.papeis, p: 'voce' } }))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    const botao = screen.getByRole('button', { name: 'Tenho medo.' })
    expect(botao.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(botao)
    const balao = document.getElementById(botao.getAttribute('aria-controls')!)! as HTMLDetailsElement
    expect(balao.open).toBe(true)
    expect(balao.querySelector('summary')).toBe(document.activeElement)
    expect(botao.getAttribute('aria-expanded')).toBe('true')
    expect(within(balao).getByText('Artigo')).toBeTruthy()
    expect(screen.getByText('Agora')).toBeTruthy()
    expect(screen.getByText('Uma voz')).toBeTruthy()
    fireEvent(balao, new Event('toggle'))
    fireEvent.click(within(balao).getByRole('button', { name: 'Voltar à fala' }))
    expect(balao.open).toBe(false)
    expect(document.activeElement).toBe(botao)
    fireEvent(balao, new Event('toggle'))
  })
  it('mantém balões e tracejados sincronizados pelo clique no resumo e fecha a fala anterior', async () => {
    vi.useFakeTimers()
    consultar.mockResolvedValue(resultado)
    render(view({ ...props, palavras: [...props.palavras, { texto: 'Estou triste.', inicioMs: 2000, fimMs: 2200, locutor: 's' }], estavelAteMs: 2500 }))
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    const primeiro = screen.getByRole('button', { name: 'Tenho medo.' })
    const segundo = screen.getByRole('button', { name: 'Estou triste.' })
    const balao1 = document.getElementById(primeiro.getAttribute('aria-controls')!)! as HTMLDetailsElement
    const balao2 = document.getElementById(segundo.getAttribute('aria-controls')!)! as HTMLDetailsElement
    balao1.open = true
    fireEvent(balao1, new Event('toggle'))
    expect(primeiro.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(segundo)
    expect(balao1.open).toBe(false)
    fireEvent(balao1, new Event('toggle'))
    expect(segundo.getAttribute('aria-expanded')).toBe('true')
    balao2.open = false
    fireEvent(balao2, new Event('toggle'))
    expect(segundo.getAttribute('aria-expanded')).toBe('false')
  })
  it('mostra o estado vazio antes de chegar qualquer palavra', () => {
    render(view({ ...props, palavras: [] }))
    expect(screen.getByText('A fala aparecerá aqui durante a sessão.')).toBeTruthy()
  })
  it('escuta o trecho em memória e mantém o texto visível sem consentimento de análise', () => {
    const ouvir = vi.fn()
    render(<I18nProvider i18n={i18n}><LiveInsights {...props} autorizada={false} onOuvir={ouvir} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvir trecho aos 0.0s' }))
    expect(ouvir).toHaveBeenCalledWith(0)
    expect(screen.getByText('Tenho medo.')).toBeTruthy()
    expect(consultar).not.toHaveBeenCalled()
  })
  it('vota útil/não útil por fonte, alterna, persiste localmente e usa o juiz do payload', async () => {
    vi.useFakeTimers()
    consultar.mockResolvedValue({ ...resultado, juiz: 'v7' })
    const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
    const mounted = render(view({ ...props, votos: { accountId: 'conta-1', kek } }))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    const util = () => screen.getAllByRole('button', { name: 'Útil' })[0]!
    const naoUtil = () => screen.getAllByRole('button', { name: 'Não útil' })[0]!
    expect(util().getAttribute('aria-pressed')).toBe('false')
    await act(async () => { fireEvent.click(util()) })
    await vi.waitFor(() => expect(util().getAttribute('aria-pressed')).toBe('true'))
    await act(async () => { fireEvent.click(naoUtil()) })
    await vi.waitFor(() => expect(naoUtil().getAttribute('aria-pressed')).toBe('true'))
    expect(util().getAttribute('aria-pressed')).toBe('false')
    const eventos = await lerVotos(kek, 'conta-1')
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({ consentiu: false, voto: 'nao_util', juiz: 'v7', obra: 'Livro', trecho: 'Citação literal.', fala: 'Tenho medo.' })
    mounted.unmount()
    localStorage.clear()
  })
  it('vota também numa fonte possível e grava a versão do juiz da resposta', async () => {
    vi.useFakeTimers()
    consultar.mockResolvedValue({ ...resultado, juiz: 'v9' })
    const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
    const mounted = render(view({ ...props, votos: { accountId: 'conta-2', kek } }))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    const possiveis = screen.getByText(/^Possíveis: confira antes de usar/).closest('details')!
    await act(async () => { fireEvent.click(within(possiveis).getByRole('button', { name: 'Não útil' })) })
    await vi.waitFor(async () => expect((await lerVotos(kek, 'conta-2'))[0]).toMatchObject({ obra: 'Artigo', voto: 'nao_util', juiz: 'v9' }))
    mounted.unmount()
    localStorage.clear()
  })
  it('sem votos não mostra botões de voto', async () => {
    vi.useFakeTimers()
    consultar.mockResolvedValue(resultado)
    render(view())
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(screen.queryByRole('button', { name: 'Útil' })).toBeNull()
  })
  describe('níveis dos cartões', () => {
    const fala = () => screen.getByRole('button', { name: 'Tenho medo.' })
    const balao = () => document.getElementById(fala().getAttribute('aria-controls')!)! as HTMLDetailsElement
    async function montarCom(retorno: Partial<ResultadoInsight>) {
      vi.useFakeTimers()
      consultar.mockResolvedValue({ ...resultado, alerta_risco: false, clarificar: false, ...retorno })
      render(view())
      await act(async () => vi.advanceTimersByTimeAsync(500))
    }

    it('mostra os fortes abertos e os possíveis num details fechado, com aviso para conferir', async () => {
      await montarCom({ cartoes: [fonte, possivel, { ...possivel, trecho_id: 't3', titulo: 'Capítulo' }] })
      fireEvent.click(fala())
      const possiveis = within(balao()).getByText(/^Possíveis: confira antes de usar/).closest('details')!
      expect(possiveis.open).toBe(false)
      expect(possiveis.textContent).toContain('(2)')
      expect(possiveis.contains(screen.getByText('Artigo'))).toBe(true)
      expect(possiveis.contains(screen.getByText('Capítulo'))).toBe(true)
      expect(possiveis.contains(screen.getByText('Livro'))).toBe(false)
      expect(balao().querySelector('summary')!.textContent).toContain('(3)')
    })
    it('sem possíveis não mostra o details; sem fortes mostra só ele', async () => {
      await montarCom({ cartoes: [fonte] })
      expect(screen.queryByText(/^Possíveis: confira antes de usar/)).toBeNull()
      cleanup()
      await montarCom({ cartoes: [possivel] })
      const possiveis = screen.getByText(/^Possíveis: confira antes de usar/).closest('details')!
      expect(possiveis.contains(screen.getByText('Artigo'))).toBe(true)
      expect(screen.queryByText('Livro')).toBeNull()
    })
    it('a escolha de referência funciona nos dois níveis', async () => {
      vi.useFakeTimers()
      consultar.mockResolvedValue(resultado)
      const onSelectFonte = vi.fn()
      render(view({ ...props, onSelectFonte }))
      await act(async () => vi.advanceTimersByTimeAsync(500))
      for (const botao of screen.getAllByRole('button', { name: 'Usar na nota' })) fireEvent.click(botao)
      expect(onSelectFonte.mock.calls.map(([, escolhida]) => escolhida.nivel)).toEqual(['forte', 'possivel'])
    })
    it.each([
      ['só possíveis', { cartoes: [possivel, { ...possivel, trecho_id: 't3' }] }, true],
      ['forte e possível', { cartoes: [fonte, possivel] }, false],
      ['só fortes', { cartoes: [fonte] }, false],
      ['possíveis com pedido de esclarecimento', { cartoes: [possivel], clarificar: true }, false],
      ['possíveis com alerta de risco', { cartoes: [possivel], alerta_risco: true }, false],
      ['sem cartões, só esclarecimento', { cartoes: [], clarificar: true }, false],
    ] as [string, Partial<ResultadoInsight>, boolean][])('sublinhado leve da fala: %s', async (_nome, retorno, leve) => {
      await montarCom(retorno)
      expect(fala().classList.contains('transcript-insight-possivel')).toBe(leve)
    })
  })
  it('não repete no balão da fala inteira as fontes já mostradas para suas frases', async () => {
    vi.useFakeTimers()
    consultar.mockImplementation(async (consulta) => {
      if (consulta.frase === 'Não durmo.') throw new Error('falha')
      return consulta.ancoras
      ? { ...resultado, cartoes: [...resultado.cartoes, { ...fonte, trecho_id: 't3', titulo: 'Novo' }] }
        : resultado
    })
    render(view({ ...props, estavelAteMs: 3000, palavras: [
      { texto: 'Tenho', inicioMs: 0, fimMs: 500, locutor: 's' }, { texto: 'medo.', inicioMs: 500, fimMs: 1000, locutor: 's' },
      { texto: 'Não', inicioMs: 1100, fimMs: 1500, locutor: 's' }, { texto: 'durmo.', inicioMs: 1500, fimMs: 2000, locutor: 's' },
      { texto: 'Conte.', inicioMs: 2100, fimMs: 2500, locutor: 'p' },
    ], papeis: { s: 'paciente', p: 'voce' } }))
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getAllByText('Novo')).toHaveLength(1)
    expect(screen.getAllByText('Livro')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Não durmo.' }).getAttribute('aria-controls')).toBeTruthy()
  })
  it('mostra o voto já gravado ao montar', async () => {
    vi.useFakeTimers()
    consultar.mockResolvedValue(resultado)
    const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
    await guardarVoto(kek, 'conta-3', { fala: 'Tenho medo.', contexto: [], trecho: 'Citação literal.', obra: 'Livro', voto: 'util', juiz: 'v1' }, false)
    const mounted = render(view({ ...props, votos: { accountId: 'conta-3', kek } }))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    await vi.waitFor(() => expect(screen.getAllByRole('button', { name: 'Útil' })[0]!.getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getAllByRole('button', { name: 'Útil' })[1]!.getAttribute('aria-pressed')).toBe('true')
    mounted.unmount()
    render(view({ ...props, votos: { accountId: 'conta-3', kek } })).unmount()
    await act(async () => vi.advanceTimersByTimeAsync(500))
    localStorage.clear()
  })
  describe('envio dos votos ao servidor', () => {
    async function montar(accountId: string) {
      vi.useFakeTimers()
      consultar.mockResolvedValue({ ...resultado, juiz: 'v7' })
      const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
      const mounted = render(view({ ...props, votos: { accountId, kek }, bibliografia: { ...bibliografia, accountId } }))
      await act(async () => vi.advanceTimersByTimeAsync(500))
      return { kek, mounted }
    }
    const util = () => screen.getAllByRole('button', { name: 'Útil' })[0]!
    afterEach(() => localStorage.clear())

    it('primeiro voto sem escolha grava local e pergunta uma vez; "Só neste aparelho" não envia nada', async () => {
      enviar.mockResolvedValue(true)
      const { kek } = await montar('conta-4')
      await act(async () => { fireEvent.click(util()) })
      const grupo = await vi.waitFor(() => screen.getByRole('group', { name: 'Enviar seus votos' }))
      expect(within(grupo).getByText('Enviar seus votos, sem identificação, para melhorar as sugestões?')).toBeTruthy()
      expect((await lerVotos(kek, 'conta-4'))[0]).toMatchObject({ consentiu: false, enviado: false })
      await act(async () => { fireEvent.click(within(grupo).getByRole('button', { name: 'Só neste aparelho' })) })
      expect(screen.queryByRole('group', { name: 'Enviar seus votos' })).toBeNull()
      expect(lerConsentimento('conta-4')).toBe('nao')
      await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Não útil' })[0]!) })
      await vi.waitFor(async () => expect((await lerVotos(kek, 'conta-4'))[0]!.voto).toBe('nao_util'))
      expect(screen.queryByRole('group', { name: 'Enviar seus votos' })).toBeNull()
      expect(enviar).not.toHaveBeenCalled()
    })

    it('"Enviar" grava o consentimento, regrava o voto com consentiu=true e o envia sem campos extras de identidade', async () => {
      enviar.mockResolvedValue(true)
      const { kek } = await montar('conta-4')
      await act(async () => { fireEvent.click(util()) })
      const enviarBotao = await vi.waitFor(() => screen.getByRole('button', { name: 'Enviar' }))
      await act(async () => { fireEvent.click(enviarBotao) })
      await vi.waitFor(() => expect(enviar).toHaveBeenCalledOnce())
      expect(lerConsentimento('conta-4')).toBe('sim')
      expect(enviar.mock.calls[0]![0]).toMatchObject({ consentiu: true, voto: 'util', juiz: 'v7', fala: 'Tenho medo.' })
      expect(enviar.mock.calls[0]![1]).toMatchObject({ accessToken: 'tok' })
      await vi.waitFor(async () => expect((await lerVotos(kek, 'conta-4'))[0]).toMatchObject({ consentiu: true, enviado: true }))
    })

    it('com consentimento sim envia direto; falha deixa pendente e a abertura da sessão reenvia', async () => {
      gravarConsentimento('conta-4', 'sim')
      enviar.mockResolvedValue(false)
      const { kek, mounted } = await montar('conta-4')
      await act(async () => { fireEvent.click(util()) })
      await vi.waitFor(() => expect(enviar).toHaveBeenCalled())
      expect(screen.queryByRole('group', { name: 'Enviar seus votos' })).toBeNull()
      expect((await lerVotos(kek, 'conta-4'))[0]).toMatchObject({ consentiu: true, enviado: false })
      mounted.unmount()
      enviar.mockResolvedValue(true)
      render(view({ ...props, votos: { accountId: 'conta-4', kek }, bibliografia }))
      await vi.waitFor(async () => expect((await lerVotos(kek, 'conta-4'))[0]!.enviado).toBe(true))
    })
  })
})

describe('transcrição em blocos contínuos', () => {
  const palavra = (texto: string, inicioMs: number, locutor: string | null) => ({ texto, inicioMs, fimMs: inicioMs + 400, locutor })
  const blocos = () => [...document.querySelectorAll('li.transcript-block')] as HTMLElement[]
  const semAnalise = { ...props, autorizada: false }

  it('junta as frases seguidas do mesmo falante e só abre outro balão quando a outra pessoa fala', () => {
    render(view({ ...semAnalise, papeis: { p: 'voce', s: 'paciente' }, palavras: [palavra('Bom dia.', 0, 'p'), palavra('Como vai?', 1000, 'p'),
      palavra('Tenho medo.', 65_000, 's'), palavra('Não durmo.', 66_000, 's'), palavra('Entendo.', 67_000, 'p')] }))
    expect(blocos().map((bloco) => [bloco.className, bloco.querySelector('strong')!.textContent, bloco.querySelector('.transcript-text')!.textContent])).toEqual([
      ['transcript-block transcript-block-voce', 'Profissional', 'Bom dia. Como vai?'],
      ['transcript-block transcript-block-paciente', 'Paciente', 'Tenho medo. Não durmo.'],
      ['transcript-block transcript-block-voce', 'Profissional', 'Entendo.'],
    ])
    expect(blocos().map((bloco) => bloco.querySelector('.transcript-meta span')!.textContent)).toEqual(['0:00', '1:05', '1:07'])
  })

  it('mostra a hipótese do servidor em tom mais claro no fim do balão atual', () => {
    render(view({ ...semAnalise, finais: 1, papeis: { p: 'voce' }, palavras: [palavra('Bom dia.', 0, 'p'), palavra('Como', 1000, 'p')] }))
    const texto = blocos()[0]!.querySelector('.transcript-text')!
    expect(texto.textContent).toBe('Bom dia. Como')
    expect(screen.getByText('Como').className).toBe('transcript-parcial')
    expect(screen.getByText('Bom dia.').className).toBe('')
  })

  it('enquanto a voz não tem papel o texto não aparece como não identificado', () => {
    render(view({ ...semAnalise, papeis: {}, palavras: [palavra('Bom dia.', 0, 'speaker_1'), palavra('Oi', 1000, null)] }))
    expect(blocos().map((bloco) => [bloco.className, bloco.querySelector('.transcript-text')!.textContent])).toEqual([
      ['transcript-block transcript-block-voce', 'Bom dia. Oi'],
    ])
    expect(screen.queryByText('Não identificado')).toBeNull()
  })

  it('numera Pessoa 2 e Pessoa 3 quando há mais de uma voz que não é o profissional', () => {
    render(view({ ...semAnalise, papeis: { p: 'voce', a: 'paciente', b: 'paciente' }, palavras: [palavra('Oi.', 0, 'p'), palavra('Eu.', 1000, 'a'), palavra('Eu também.', 2000, 'b')] }))
    expect(blocos().map((bloco) => bloco.querySelector('strong')!.textContent)).toEqual(['Profissional', 'Pessoa 2', 'Pessoa 3'])
  })

  it('a escuta do áudio vale por balão, a partir do início dele', () => {
    const ouvir = vi.fn()
    render(<I18nProvider i18n={i18n}><LiveInsights {...semAnalise} papeis={{ s: 'paciente' }} onOuvir={ouvir} palavras={[palavra('Oi.', 3500, 's'), palavra('Tchau.', 4500, 's')]} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvir trecho aos 3.5s' }))
    expect(ouvir).toHaveBeenCalledOnce()
    expect(ouvir).toHaveBeenCalledWith(3500)
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})

describe('detalhes dos insights', () => {
  const sempre = (retorno: Partial<ResultadoInsight> = {}) => consultar.mockResolvedValue({ ...resultado, alerta_risco: false, clarificar: false, ...retorno })
  async function montar(extra: Partial<ComponentProps<typeof LiveInsights>> = {}, retorno: Partial<ResultadoInsight> = {}) {
    vi.useFakeTimers()
    sempre(retorno)
    const mounted = render(view({ ...props, ...extra }))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    return mounted
  }

  it('nomeia as seções e só mostra a dica de insight enquanto não há nenhum', async () => {
    vi.useFakeTimers()
    sempre()
    render(view())
    expect(screen.getByRole('region', { name: 'Copiloto' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Transcrição ao vivo' })).toBeTruthy()
    expect(screen.getByText('Quando houver um insight, a fala será marcada com tracejado.')).toBeTruthy()
    expect(screen.queryByText('A fala aparecerá aqui durante a sessão.')).toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(screen.queryByText('Quando houver um insight, a fala será marcada com tracejado.')).toBeNull()
  })

  it('cada fonte mostra título, autor, página, o fenômeno e a citação; o alerta de risco só quando existe', async () => {
    await montar({}, { alerta_risco: true })
    expect(screen.getByText('Livro').parentElement!.textContent).toBe('Livro — Autor')
    expect(screen.getAllByText('Medo — Medo')).toHaveLength(2)
    expect(screen.getByText('Avalie esta fala no contexto do atendimento.')).toBeTruthy()
    cleanup()
    await montar({}, { cartoes: [{ ...fonte, fenomeno_na_fala: '', fenomeno_no_trecho: 'No trecho' }] })
    expect(screen.getByText('— No trecho')).toBeTruthy()
    expect(screen.queryByText('Avalie esta fala no contexto do atendimento.')).toBeNull()
    expect(screen.queryByText('Esclareça o contexto desta fala com o paciente.')).toBeNull()
  })

  it('a fala marcada leva a classe própria e a leve só quando há apenas possíveis', async () => {
    await montar({}, { cartoes: [fonte] })
    expect(screen.getByRole('button', { name: 'Tenho medo.' }).className).toBe('transcript-insight')
    cleanup()
    await montar({}, { cartoes: [possivel] })
    expect(screen.getByRole('button', { name: 'Tenho medo.' }).className).toBe('transcript-insight transcript-insight-possivel')
  })

  it('avisa para salvar a revisão só quando há fontes e nenhuma ação de escolher', async () => {
    await montar()
    expect(screen.getByText('Salve a revisão da transcrição para usar uma referência na nota.')).toBeTruthy()
    cleanup()
    await montar({ onSelectFonte: vi.fn() })
    expect(screen.queryByText('Salve a revisão da transcrição para usar uma referência na nota.')).toBeNull()
    cleanup()
    await montar({}, { cartoes: [], clarificar: true })
    expect(screen.queryByText('Salve a revisão da transcrição para usar uma referência na nota.')).toBeNull()
  })

  it('rola até o balão ao abrir e de volta à fala ao retornar', async () => {
    const rolar = vi.fn()
    Element.prototype.scrollIntoView = rolar
    try {
      await montar()
      fireEvent.click(screen.getByRole('button', { name: 'Tenho medo.' }))
      expect(rolar).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'smooth' })
      rolar.mockClear()
      fireEvent.click(screen.getAllByRole('button', { name: 'Voltar à fala' })[0]!)
      expect(rolar).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', behavior: 'smooth' })
    } finally { Reflect.deleteProperty(Element.prototype, 'scrollIntoView') }
  })

  it('a escolha numa fala inteira usa o início da primeira frase e o fim da última', async () => {
    vi.useFakeTimers()
    consultar.mockImplementation(async (consulta) => consulta.ancoras
      ? { ...resultado, cartoes: [{ ...fonte, trecho_id: 't9', titulo: 'Da fala inteira' }], alerta_risco: false, clarificar: false }
      : { ...resultado, cartoes: [], alerta_risco: false, clarificar: false })
    const onSelectFonte = vi.fn()
    render(view({ ...props, onSelectFonte, estavelAteMs: 3000, papeis: { s: 'paciente', p: 'voce' }, palavras: [
      { texto: 'Tenho medo.', inicioMs: 0, fimMs: 500, locutor: 's' }, { texto: 'Não durmo.', inicioMs: 600, fimMs: 1000, locutor: 's' },
      { texto: 'Conte.', inicioMs: 1100, fimMs: 1200, locutor: 'p' },
    ] }))
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    fireEvent.click(screen.getAllByRole('button', { name: 'Usar na nota' })[0]!)
    expect(onSelectFonte).toHaveBeenCalledWith(expect.objectContaining({ id: 'turno:0:s', ancoras: ['0:s', '600:s'] }), expect.objectContaining({ trecho_id: 't9' }), 0, 1000)
  })

  it('com trilhas separadas, as linhas saem por início mesmo vindas de falantes diferentes e só contam palavras com falante', async () => {
    await montar({ trilhasSeparadas: true, autorizada: false, estavelAteMs: 5000, papeis: { s: 'paciente', p: 'voce' }, palavras: [
      { texto: 'Depois.', inicioMs: 3000, fimMs: 3500, locutor: 's' }, { texto: 'Primeiro.', inicioMs: 100, fimMs: 600, locutor: 'p' },
      { texto: 'Meio.', inicioMs: 1500, fimMs: 2000, locutor: 's' },
    ] })
    const texto = [...document.querySelectorAll('.transcript-text')].map((bloco) => bloco.textContent)
    expect(texto).toEqual(['Primeiro.', 'Meio. Depois.'])
  })

  it('trocar a bibliografia refaz as consultas e desmontar encerra as que estão em curso', async () => {
    vi.useFakeTimers()
    let sinal!: AbortSignal
    consultar.mockImplementation((_consulta, signal) => { sinal = signal; return new Promise(() => {}) })
    const mounted = render(view({ ...props, bibliografia }))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(consultar).toHaveBeenCalledOnce()
    mounted.rerender(view({ ...props, bibliografia: { ...bibliografia, materialIds: ['m1'] } }))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(consultar).toHaveBeenCalledTimes(2)
    expect(consultar.mock.lastCall![4]).toEqual({ ...bibliografia, materialIds: ['m1'] })
    mounted.unmount()
    expect(sinal.aborted).toBe(true)
  })

  it('o voto de uma fonte não marca as outras e o consentimento "Só neste aparelho" não regrava', async () => {
    vi.useFakeTimers()
    consultar.mockResolvedValue({ ...resultado, cartoes: [fonte, { ...possivel, citacao_literal: 'Outra citação.' }] })
    const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
    render(view({ ...props, votos: { accountId: 'conta-9', kek } }))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(screen.getAllByRole('group', { name: 'Esta fonte foi útil?', hidden: true })).toHaveLength(2)
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Útil' })[0]!) })
    await vi.waitFor(() => expect(screen.getAllByRole('button', { name: 'Útil' })[0]!.getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getAllByRole('button', { name: 'Útil' })[1]!.getAttribute('aria-pressed')).toBe('false')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Só neste aparelho' })) })
    expect(await lerVotos(kek, 'conta-9')).toHaveLength(1)
    localStorage.clear()
  })

  it('o resultado de uma fala cujo contexto mudou não vale para o novo contexto', async () => {
    vi.useFakeTimers()
    consultar.mockResolvedValue(resultado)
    const duas = [
      { texto: 'Tenho medo.', inicioMs: 0, fimMs: 500, locutor: 's' }, { texto: 'Conte.', inicioMs: 600, fimMs: 700, locutor: 'p' },
      { texto: 'Estou triste.', inicioMs: 800, fimMs: 1000, locutor: 's' },
    ]
    const papeis = { s: 'paciente' as const, p: 'voce' as const }
    const mounted = render(view({ ...props, papeis, palavras: duas, estavelAteMs: 1500 }))
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByRole('button', { name: 'Estou triste.' })).toBeTruthy()
    consultar.mockImplementation(() => new Promise(() => {}))
    mounted.rerender(view({ ...props, papeis, palavras: [{ ...duas[0]!, texto: 'Não tenho medo.' }, duas[1]!, duas[2]!], estavelAteMs: 1500 }))
    expect(screen.queryByRole('button', { name: 'Estou triste.' })).toBeNull()
  })
})
