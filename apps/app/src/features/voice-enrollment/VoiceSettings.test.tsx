import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto } from '@limmiar/crypto'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import { VoiceSettings } from './VoiceSettings'
import { capturarPerfil } from './capturar-perfil'
import { cadastrarVoz, obterCadastroVoz, removerCadastroVoz } from '../../entities/voz/voice-enrollment'
import * as cifra from '../../entities/voz/voice-crypto'

vi.mock('./capturar-perfil', () => ({ capturarPerfil: vi.fn() }))
vi.mock('../../entities/voz/voice-enrollment', () => ({ cadastrarVoz: vi.fn(), obterCadastroVoz: vi.fn(), removerCadastroVoz: vi.fn() }))
const props = { baseUrl: '', accountId: 'conta', accessToken: 'token', kek: {} as CryptoKey }
beforeAll(async () => dynamicActivate('pt-BR'))
beforeEach(async () => {
  props.kek = await webcrypto.importKek(new Uint8Array(32).fill(3))
  vi.mocked(obterCadastroVoz).mockResolvedValue({ ok: false, code: 'voice.enrollment_not_found', params: {} })
  vi.mocked(cadastrarVoz).mockResolvedValue({ ok: true })
  vi.mocked(removerCadastroVoz).mockResolvedValue({ ok: true })
  vi.mocked(capturarPerfil).mockImplementation(async (_signal, progresso) => { progresso(15); return new Array(192).fill(0.1) })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })
async function montar() {
  const view = render(<I18nProvider i18n={i18n}><VoiceSettings {...props} /></I18nProvider>)
  await waitFor(() => expect(screen.getByLabelText('Autorizo o uso do microfone para cadastrar minha voz.')).toHaveProperty('disabled', false))
  return view
}
function iniciar() {
  fireEvent.click(screen.getByLabelText('Autorizo o uso do microfone para cadastrar minha voz.'))
  fireEvent.click(screen.getByRole('button', { name: /Cadastrar minha voz|Substituir perfil de voz/ }))
}
async function comPerfil() {
  vi.mocked(obterCadastroVoz).mockResolvedValueOnce({ ok: true, ...await cifra.selarEmbedding(props.kek, props.accountId, new Array(192).fill(0.1)) })
  return montar()
}

describe('configuração da voz na conta', () => {
  it('exige autorização, salva apenas após a amostra e limpa o vetor em memória', async () => {
    const vetor = new Array(192).fill(0.1)
    let liberar!: (vetor: number[]) => void
    vi.mocked(capturarPerfil).mockImplementationOnce(async (_signal, progresso) => {
      progresso(7)
      return new Promise((resolve) => { liberar = resolve })
    })
    await montar()
    expect(screen.getByRole('button', { name: 'Cadastrar minha voz' })).toHaveProperty('disabled', true)
    iniciar()
    await screen.findByText('Amostra: 7 de 15 segundos.')
    expect(cadastrarVoz).not.toHaveBeenCalled()
    await act(async () => liberar(vetor))
    await screen.findByText('Perfil de voz salvo. Ele será usado nas próximas sessões.')
    expect(cadastrarVoz).toHaveBeenCalledWith('', 'conta', 'token', props.kek, vetor)
    expect(vetor.every((v) => v === 0)).toBe(true)
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
  })
  it('abre perfil cifrado, substitui e remove a voz cadastrada', async () => {
    await comPerfil()
    expect(screen.getByText('Você já tem um perfil de voz.')).toBeTruthy()
    iniciar()
    await screen.findByText('Perfil de voz salvo. Ele será usado nas próximas sessões.')
    fireEvent.click(screen.getByRole('button', { name: 'Remover perfil de voz' }))
    await screen.findByText('Perfil de voz removido.')
    expect(removerCadastroVoz).toHaveBeenCalledWith('', 'conta', 'token')
    expect(screen.getByText('Você ainda não tem um perfil de voz.')).toBeTruthy()
  })
  it.each(['api', 'cifra'])('informa falha de leitura %s sem afirmar ausência de perfil', async (etapa) => {
    if (etapa === 'api') vi.mocked(obterCadastroVoz).mockResolvedValueOnce({ ok: false, code: 'auth.invalid_session', params: {} })
    else vi.mocked(obterCadastroVoz).mockResolvedValueOnce({ ok: true, wrappedDek: new Uint8Array(60), sealedEmbedding: new Uint8Array(796) })
    await montar()
    expect(screen.getByText('Não foi possível abrir seu perfil de voz. Tente novamente.')).toBeTruthy()
    expect(screen.queryByText('Você ainda não tem um perfil de voz.')).toBeNull()
  })
  it.each(['microfone', 'api'])('informa falha de cadastro %s e permite tentar novamente', async (etapa) => {
    if (etapa === 'microfone') vi.mocked(capturarPerfil).mockRejectedValueOnce(new Error('permissão negada'))
    else vi.mocked(cadastrarVoz).mockResolvedValueOnce({ ok: false, code: 'auth.invalid_session', params: {} })
    await montar(); iniciar()
    await screen.findByText(/^Não foi possível cadastrar sua voz\. Permita o microfone e fale sozinho durante toda a amostra\./)
    expect(screen.getByRole('button', { name: 'Cadastrar minha voz' })).toHaveProperty('disabled', false)
  })
  it('mostra a causa técnica do erro e aceita rejeição que não é Error', async () => {
    vi.mocked(capturarPerfil).mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))
    await montar(); iniciar()
    await screen.findByText(/\(NotAllowedError: Permission denied\)$/)
    cleanup()
    vi.mocked(capturarPerfil).mockRejectedValueOnce('texto solto')
    await montar(); iniciar()
    expect((await screen.findByText(/^Não foi possível cadastrar sua voz/)).textContent).not.toContain('(')
  })
  it.each(['cancelar', 'sair'])('ignora amostra tardia depois de %s e limpa seu vetor', async (etapa) => {
    let liberar!: (vetor: number[]) => void
    let signal!: AbortSignal
    let informar!: (valor: number) => void
    vi.mocked(capturarPerfil).mockImplementationOnce((abort, progresso) => { signal = abort; informar = progresso; return new Promise((resolve) => { liberar = resolve }) })
    const view = await montar(); iniciar()
    await waitFor(() => expect(capturarPerfil).toHaveBeenCalled())
    if (etapa === 'cancelar') {
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
      expect(screen.getByText('Cadastro cancelado.')).toBeTruthy()
    } else view.unmount()
    expect(signal.aborted).toBe(true)
    const vetor = new Array(192).fill(0.1)
    await act(async () => { informar(14); liberar(vetor) })
    expect(cadastrarVoz).not.toHaveBeenCalled()
    expect(vetor.every((v) => v === 0)).toBe(true)
  })
  it('ignora rejeição tardia após cancelar', async () => {
    let rejeitar!: (erro: Error) => void
    vi.mocked(capturarPerfil).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeitar = reject }))
    await montar(); iniciar()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await act(async () => rejeitar(new Error('falha tardia')))
    expect(screen.getByText('Cadastro cancelado.')).toBeTruthy()
  })
  it.each(['sucesso', 'falha'])('ignora gravação do perfil %s após saída', async (etapa) => {
    let liberar!: (resultado: Awaited<ReturnType<typeof cadastrarVoz>>) => void
    vi.mocked(cadastrarVoz).mockImplementationOnce(() => new Promise((resolve) => { liberar = resolve }))
    const view = await montar(); iniciar()
    await screen.findByText('Cifrando seu perfil de voz...')
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
    view.unmount()
    await act(async () => liberar(etapa === 'sucesso' ? { ok: true } : { ok: false, code: 'erro', params: {} }))
  })
  it.each(['sucesso', 'falha', 'sair', 'sair-falha'])('remoção %s mantém estado correto', async (etapa) => {
    let liberar!: (resultado: Awaited<ReturnType<typeof removerCadastroVoz>>) => void
    vi.mocked(removerCadastroVoz).mockImplementationOnce(() => new Promise((resolve) => { liberar = resolve }))
    const view = await comPerfil()
    fireEvent.click(screen.getByRole('button', { name: 'Remover perfil de voz' }))
    if (etapa.startsWith('sair')) view.unmount()
    await act(async () => liberar(etapa.endsWith('falha') ? { ok: false, code: 'erro', params: {} } : { ok: true }))
    if (etapa === 'falha') expect(screen.getByText('Não foi possível remover seu perfil de voz.')).toBeTruthy()
    if (etapa === 'sucesso') expect(screen.getByText('Perfil de voz removido.')).toBeTruthy()
  })
  it('ignora leitura tardia e libera vetor decifrado após saída', async () => {
    let liberarLeitura!: (resultado: Awaited<ReturnType<typeof obterCadastroVoz>>) => void
    vi.mocked(obterCadastroVoz).mockImplementationOnce(() => new Promise((resolve) => { liberarLeitura = resolve }))
    const view = render(<I18nProvider i18n={i18n}><VoiceSettings {...props} /></I18nProvider>)
    view.unmount()
    await act(async () => liberarLeitura({ ok: false, code: 'voice.enrollment_not_found', params: {} }))
    let liberarVetor!: (vetor: number[]) => void
    vi.spyOn(cifra, 'abrirEmbedding').mockImplementationOnce(() => new Promise((resolve) => { liberarVetor = resolve }))
    const cadastro = await cifra.selarEmbedding(props.kek, props.accountId, new Array(192).fill(0.1))
    vi.mocked(obterCadastroVoz).mockResolvedValueOnce({ ok: true, ...cadastro })
    const outra = render(<I18nProvider i18n={i18n}><VoiceSettings {...props} /></I18nProvider>)
    await waitFor(() => expect(cifra.abrirEmbedding).toHaveBeenCalled())
    outra.unmount()
    const vetor = new Array(192).fill(0.1)
    await act(async () => liberarVetor(vetor))
    expect(vetor.every((v) => v === 0)).toBe(true)
  })
  it('ignora falha tardia de leitura após saída', async () => {
    let falhar!: (erro: Error) => void
    vi.mocked(obterCadastroVoz).mockImplementationOnce(() => new Promise((_resolve, reject) => { falhar = reject }))
    const view = render(<I18nProvider i18n={i18n}><VoiceSettings {...props} /></I18nProvider>)
    view.unmount()
    await act(async () => falhar(new Error('falha tardia')))
  })

  const autorizo = () => screen.getByLabelText('Autorizo o uso do microfone para cadastrar minha voz.')
  const leitura = () => deferred<Awaited<ReturnType<typeof obterCadastroVoz>>>()
  const NAO_ENCONTRADO = { ok: false as const, code: 'voice.enrollment_not_found', params: {} }
  const outraSessao = (view: ReturnType<typeof render>) => view.rerender(<I18nProvider i18n={i18n}><VoiceSettings {...props} accessToken="token-novo" /></I18nProvider>)

  it('enquanto lê o perfil bloqueia tudo, sem oferecer cancelar nem afirmar nada, e depois mostra só a situação', async () => {
    const pendente = leitura()
    vi.mocked(obterCadastroVoz).mockReturnValueOnce(pendente.promise)
    render(<I18nProvider i18n={i18n}><VoiceSettings {...props} /></I18nProvider>)
    expect(autorizo()).toHaveProperty('disabled', true)
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('region', { name: 'Seu perfil de voz' })).toBeTruthy()
    await act(async () => pendente.resolve(NAO_ENCONTRADO))
    expect(autorizo()).toHaveProperty('disabled', false)
    expect(screen.getAllByRole('status').map((aviso) => aviso.textContent)).toEqual(['Você ainda não tem um perfil de voz.'])
    expect(screen.queryByText('Não foi possível abrir seu perfil de voz. Tente novamente.')).toBeNull()
  })

  it('perfil já cadastrado é anunciado sem aviso nenhum a mais e os botões acompanham', async () => {
    await comPerfil()
    expect(screen.getAllByRole('status').map((aviso) => aviso.textContent)).toEqual(['Você já tem um perfil de voz.'])
    expect(screen.getByRole('button', { name: 'Substituir perfil de voz' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remover perfil de voz' })).toHaveProperty('disabled', false)
  })

  it('avisa o preparo do reconhecimento antes da primeira amostra e não mostra segundos zerados', async () => {
    vi.mocked(capturarPerfil).mockImplementationOnce(() => new Promise(() => {}))
    await montar(); iniciar()
    expect(screen.getByText('Preparando o reconhecimento local. Depois, permita o microfone e leia as três linhas.')).toBeTruthy()
    expect(screen.queryByText(/^Amostra:/)).toBeNull()
    expect(autorizo()).toHaveProperty('disabled', true)
  })

  it('terminada a amostra não sobra o contador nem o botão de cancelar, e a falha não-Error não leva sufixo', async () => {
    await montar(); iniciar()
    await screen.findByText('Perfil de voz salvo. Ele será usado nas próximas sessões.')
    expect(screen.queryByText(/^Amostra:/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
    cleanup()
    vi.mocked(capturarPerfil).mockRejectedValueOnce('texto solto')
    await montar(); iniciar()
    expect((await screen.findByText(/^Não foi possível cadastrar sua voz/)).textContent).toBe('Não foi possível cadastrar sua voz. Permita o microfone e fale sozinho durante toda a amostra.')
  })

  it('cancelar libera os controles e some com o botão', async () => {
    vi.mocked(capturarPerfil).mockImplementationOnce(() => new Promise(() => {}))
    await montar(); iniciar()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
    expect(autorizo()).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: 'Cadastrar minha voz' })).toHaveProperty('disabled', false)
  })

  it('depois de uma falha de cadastro, remover não oferece cancelar', async () => {
    const remocao = deferred<Awaited<ReturnType<typeof removerCadastroVoz>>>()
    vi.mocked(removerCadastroVoz).mockReturnValueOnce(remocao.promise)
    vi.mocked(capturarPerfil).mockRejectedValueOnce(new Error('permissão negada'))
    await comPerfil(); iniciar()
    await screen.findByText(/^Não foi possível cadastrar sua voz/)
    fireEvent.click(screen.getByRole('button', { name: 'Remover perfil de voz' }))
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remover perfil de voz' })).toHaveProperty('disabled', true)
    expect(autorizo()).toHaveProperty('disabled', true)
    await act(async () => remocao.resolve({ ok: true }))
    expect(autorizo()).toHaveProperty('disabled', false)
    expect(screen.getByText('Perfil de voz removido.')).toBeTruthy()
  })

  it('remoção que falha libera os controles e diz que falhou', async () => {
    vi.mocked(removerCadastroVoz).mockResolvedValueOnce({ ok: false, code: 'erro', params: {} })
    await comPerfil()
    fireEvent.click(screen.getByRole('button', { name: 'Remover perfil de voz' }))
    expect(await screen.findByText('Não foi possível remover seu perfil de voz.')).toBeTruthy()
    expect(autorizo()).toHaveProperty('disabled', false)
    expect(screen.getByText('Você já tem um perfil de voz.')).toBeTruthy()
  })

  it('a leitura de uma sessão anterior que termina tarde não mexe na tela da atual', async () => {
    const antiga = leitura()
    const atual = leitura()
    vi.mocked(obterCadastroVoz).mockReturnValueOnce(antiga.promise).mockReturnValueOnce(atual.promise)
    const view = render(<I18nProvider i18n={i18n}><VoiceSettings {...props} /></I18nProvider>)
    outraSessao(view)
    await waitFor(() => expect(obterCadastroVoz).toHaveBeenCalledTimes(2))

    await act(async () => antiga.resolve(NAO_ENCONTRADO))
    expect(screen.queryByRole('status')).toBeNull()
    expect(autorizo()).toHaveProperty('disabled', true)

    await act(async () => atual.resolve(NAO_ENCONTRADO))
    expect(autorizo()).toHaveProperty('disabled', false)
  })

  it('um perfil tardio de uma sessão anterior não vira o perfil da atual e a decifragem tardia é limpa', async () => {
    const antiga = leitura()
    const cadastro = await cifra.selarEmbedding(props.kek, props.accountId, new Array(192).fill(0.1))
    vi.mocked(obterCadastroVoz).mockReturnValueOnce(antiga.promise).mockResolvedValueOnce(NAO_ENCONTRADO)
    const abrir = vi.spyOn(cifra, 'abrirEmbedding')
    const view = render(<I18nProvider i18n={i18n}><VoiceSettings {...props} /></I18nProvider>)
    outraSessao(view)
    await screen.findByText('Você ainda não tem um perfil de voz.')

    await act(async () => antiga.resolve({ ok: true, ...cadastro }))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })

    expect(screen.getByText('Você ainda não tem um perfil de voz.')).toBeTruthy()
    expect(abrir).not.toHaveBeenCalled()
  })

  it('uma falha tardia de leitura de uma sessão anterior não acende aviso nem libera a tela da atual', async () => {
    const antiga = leitura()
    const atual = leitura()
    vi.mocked(obterCadastroVoz).mockReturnValueOnce(antiga.promise).mockReturnValueOnce(atual.promise)
    const view = render(<I18nProvider i18n={i18n}><VoiceSettings {...props} /></I18nProvider>)
    outraSessao(view)
    await waitFor(() => expect(obterCadastroVoz).toHaveBeenCalledTimes(2))

    await act(async () => antiga.reject(new Error('rede')))

    expect(screen.queryByText('Não foi possível abrir seu perfil de voz. Tente novamente.')).toBeNull()
    expect(autorizo()).toHaveProperty('disabled', true)
    await act(async () => atual.resolve(NAO_ENCONTRADO))
  })

  it('a amostra de antes do cancelamento não atualiza o contador da próxima', async () => {
    let informar!: (valor: number) => void
    vi.mocked(capturarPerfil).mockImplementationOnce((_signal, progresso) => { informar = progresso; return new Promise(() => {}) })
    vi.mocked(capturarPerfil).mockImplementationOnce(() => new Promise(() => {}))
    await montar(); iniciar()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar minha voz' }))
    act(() => informar(14))
    expect(screen.queryByText(/^Amostra:/)).toBeNull()
  })

  it('uma gravação de perfil de sessão anterior não mostra sucesso na atual', async () => {
    const gravacao = deferred<Awaited<ReturnType<typeof cadastrarVoz>>>()
    vi.mocked(cadastrarVoz).mockReturnValueOnce(gravacao.promise)
    const view = await montar(); iniciar()
    await screen.findByText('Cifrando seu perfil de voz...')
    outraSessao(view)
    await act(async () => gravacao.resolve({ ok: true }))
    expect(screen.queryByText('Perfil de voz salvo. Ele será usado nas próximas sessões.')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Seu perfil de voz' })).queryByText('Você já tem um perfil de voz.')).toBeNull()
  })

  it('uma gravação que falha tarde, de sessão anterior, não mostra erro na atual', async () => {
    const gravacao = deferred<Awaited<ReturnType<typeof cadastrarVoz>>>()
    vi.mocked(cadastrarVoz).mockReturnValueOnce(gravacao.promise)
    const view = await montar(); iniciar()
    await screen.findByText('Cifrando seu perfil de voz...')
    outraSessao(view)
    await act(async () => gravacao.resolve({ ok: false, code: 'erro', params: {} }))
    expect(screen.queryByText(/^Não foi possível cadastrar sua voz/)).toBeNull()
  })

  it('uma remoção de sessão anterior que termina tarde não altera a tela da atual', async () => {
    const remocao = deferred<Awaited<ReturnType<typeof removerCadastroVoz>>>()
    vi.mocked(removerCadastroVoz).mockReturnValueOnce(remocao.promise)
    const view = await comPerfil()
    fireEvent.click(screen.getByRole('button', { name: 'Remover perfil de voz' }))
    outraSessao(view)
    await act(async () => remocao.resolve({ ok: true }))
    expect(screen.queryByText('Perfil de voz removido.')).toBeNull()
  })

  it('uma remoção que falha tarde, de sessão anterior, não mostra erro na atual', async () => {
    const remocao = deferred<Awaited<ReturnType<typeof removerCadastroVoz>>>()
    vi.mocked(removerCadastroVoz).mockReturnValueOnce(remocao.promise)
    const view = await comPerfil()
    fireEvent.click(screen.getByRole('button', { name: 'Remover perfil de voz' }))
    outraSessao(view)
    await act(async () => remocao.resolve({ ok: false, code: 'erro', params: {} }))
    expect(screen.queryByText('Não foi possível remover seu perfil de voz.')).toBeNull()
  })
})
