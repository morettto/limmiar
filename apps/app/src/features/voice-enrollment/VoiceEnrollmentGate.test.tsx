import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto } from '@limmiar/crypto'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { selarEmbedding } from '../../entities/voz/voice-crypto'
import { obterCadastroVoz, cadastrarVoz, removerCadastroVoz } from '../../entities/voz/voice-enrollment'
import { capturarPerfil } from './capturar-perfil'
import { VoiceOnboarding } from './VoiceEnrollmentGate'
import { VoiceSettings } from './VoiceSettings'

vi.mock('../../entities/voz/voice-enrollment', () => ({ obterCadastroVoz: vi.fn(), cadastrarVoz: vi.fn(), removerCadastroVoz: vi.fn() }))
vi.mock('./capturar-perfil', () => ({ capturarPerfil: vi.fn() }))
beforeAll(async () => dynamicActivate('pt-BR'))
afterEach(() => { cleanup(); vi.resetAllMocks() })

async function mount(existing = false) {
  const kek = await webcrypto.importKek(new Uint8Array(32).fill(3))
  const props = { baseUrl: '', accountId: 'professional', accessToken: 'token', kek }
  vi.mocked(obterCadastroVoz).mockResolvedValue(existing
    ? { ok: true, ...await selarEmbedding(kek, props.accountId, new Array(192).fill(.1)) }
    : { ok: false, code: 'voice.enrollment_not_found', params: {} })
  const exit = vi.fn()
  render(<I18nProvider i18n={i18n}><VoiceOnboarding {...props} onExit={exit}>
    <div>Consultório liberado</div><VoiceSettings {...props} />
  </VoiceOnboarding></I18nProvider>)
  return exit
}

describe('cadastro obrigatório de voz', () => {
  it('não monta o consultório até capturar e salvar; falha permite tentar novamente', async () => {
    vi.mocked(capturarPerfil).mockResolvedValue(new Array(192).fill(.1))
    vi.mocked(cadastrarVoz).mockResolvedValueOnce({ ok: false, code: 'auth.invalid_session', params: {} }).mockResolvedValue({ ok: true })
    await mount()
    await screen.findByText('Você ainda não tem um perfil de voz.')
    expect(screen.queryByText('Consultório liberado')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar minha voz' }))
    await screen.findByText(/^Não foi possível cadastrar sua voz/)
    expect(screen.queryByText('Consultório liberado')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar minha voz' }))
    await screen.findByText('Consultório liberado')
  })

  it('abre um perfil existente e volta a bloquear quando ele é removido', async () => {
    vi.mocked(removerCadastroVoz).mockResolvedValue({ ok: true })
    await mount(true)
    await screen.findByText('Consultório liberado')
    vi.mocked(obterCadastroVoz).mockResolvedValue({ ok: false, code: 'voice.enrollment_not_found', params: {} })
    fireEvent.click(await screen.findByRole('button', { name: 'Remover perfil de voz' }))
    await screen.findByRole('heading', { name: 'Vamos reconhecer a sua voz' })
    expect(screen.queryByText('Consultório liberado')).toBeNull()
  })

  it('permite sair sem concluir', async () => {
    const exit = await mount()
    await waitFor(() => expect(screen.getByRole('checkbox')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Sair da conta' }))
    expect(exit).toHaveBeenCalledOnce()
  })

  it('enquanto o perfil é verificado mostra só o carregamento, nunca a configuração', async () => {
    const props = { baseUrl: '', accountId: 'professional', accessToken: 'token', kek: await webcrypto.importKek(new Uint8Array(32).fill(3)) }
    vi.mocked(obterCadastroVoz).mockReturnValue(new Promise(() => {}))
    render(<I18nProvider i18n={i18n}><VoiceOnboarding {...props} onExit={() => {}}>Consultório liberado</VoiceOnboarding></I18nProvider>)
    expect(screen.getByRole('status').textContent).toBe('Verificando seu perfil de voz...')
    expect(screen.queryByRole('heading', { name: 'Vamos reconhecer a sua voz' })).toBeNull()
    expect(screen.queryByText('Consultório liberado')).toBeNull()
  })

  it('falha na leitura mostra erro com nova tentativa, sem a configuração nem substituir o perfil válido', async () => {
    const props = { baseUrl: '', accountId: 'professional', accessToken: 'token', kek: await webcrypto.importKek(new Uint8Array(32).fill(3)) }
    const perfil = await selarEmbedding(props.kek, props.accountId, new Array(192).fill(.1))
    vi.mocked(obterCadastroVoz).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, ...perfil })
    render(<I18nProvider i18n={i18n}><VoiceOnboarding {...props} onExit={() => {}}>Consultório recuperado</VoiceOnboarding></I18nProvider>)
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível abrir seu perfil de voz. Tente novamente.')
    expect(screen.queryByRole('heading', { name: 'Vamos reconhecer a sua voz' })).toBeNull()
    expect(screen.queryByText('Consultório recuperado')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await screen.findByText('Consultório recuperado')
    expect(capturarPerfil).not.toHaveBeenCalled()
  })

  it.each(['ausência', 'falha'])('%s tardia de uma chave anterior não fecha o consultório aberto com a chave atual', async (tardia) => {
    const props = { baseUrl: '', accountId: 'professional', accessToken: 'token' }
    const anterior = await webcrypto.importKek(new Uint8Array(32).fill(3))
    const atual = await webcrypto.importKek(new Uint8Array(32).fill(4))
    let responderAnterior!: (resposta: Awaited<ReturnType<typeof obterCadastroVoz>>) => void
    let falharAnterior!: (erro: Error) => void
    vi.mocked(obterCadastroVoz).mockReturnValueOnce(new Promise((resolve, reject) => { responderAnterior = resolve; falharAnterior = reject }))
      .mockResolvedValueOnce({ ok: true, ...await selarEmbedding(atual, props.accountId, new Array(192).fill(.1)) })
    const view = render(<I18nProvider i18n={i18n}><VoiceOnboarding {...props} kek={anterior} onExit={() => {}}>Consultório liberado</VoiceOnboarding></I18nProvider>)
    view.rerender(<I18nProvider i18n={i18n}><VoiceOnboarding {...props} kek={atual} onExit={() => {}}>Consultório liberado</VoiceOnboarding></I18nProvider>)
    await screen.findByText('Consultório liberado')
    await act(async () => {
      if (tardia === 'falha') falharAnterior(new Error('offline'))
      else responderAnterior({ ok: false, code: 'voice.enrollment_not_found', params: {} })
    })
    expect(screen.getByText('Consultório liberado')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Vamos reconhecer a sua voz' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
