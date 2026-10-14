import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import { abrirMicrofone, type MicrofoneAutorizado } from '../../entities/consentimento/microfone'
import { conectarChamada } from './chamada'
import { OnlineCall, type OnlineCallProps } from './OnlineCall'

vi.mock('../../entities/consentimento/microfone', () => ({ abrirMicrofone: vi.fn() }))
vi.mock('./chamada', () => ({ conectarChamada: vi.fn() }))
const encerrar = vi.fn(), sair = vi.fn(), silenciar = vi.fn(), reconectar = vi.fn()
const stop = vi.fn()
const local = { getTracks: () => [{ stop }] } as unknown as MediaStream
const microfone = { stream: local } as MicrofoneAutorizado
const remoto = { getTracks: () => [] } as unknown as MediaStream
const props: OnlineCallProps = { baseUrl: '/api', roomId: 'sala', token: 'credencial', papel: 'professional' }
beforeAll(async () => dynamicActivate('pt-BR'))
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.mocked(abrirMicrofone).mockResolvedValue({ ok: true, microfone })
  vi.mocked(conectarChamada).mockImplementation(async entrada => {
    entrada.estado('aguardando')
    return { encerrar, sair, silenciar, reconectar }
  })
  reconectar.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks() })
function montar(input = props) { return render(<I18nProvider i18n={i18n}><OnlineCall {...input} /></I18nProvider>) }
async function entrar() {
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Entrar na sessão online' }))
  await waitFor(() => expect(conectarChamada).toHaveBeenCalled())
}
describe('permissões e ciclo da chamada online', () => {
  it('solicita o microfone somente depois da autorização e entrada explícita', async () => {
    montar()
    expect(screen.getByRole('button', { name: 'Entrar na sessão online' })).toHaveProperty('disabled', true)
    expect(abrirMicrofone).not.toHaveBeenCalled()
    await entrar()
    expect(abrirMicrofone).toHaveBeenCalledExactlyOnceWith('concedido')
    expect(screen.getByRole('status').textContent).toBe('Aguardando o outro participante.')
    expect(vi.mocked(conectarChamada).mock.calls[0]![0]).toMatchObject({ ...props, stream: local })
  })
  it('permite tentar novamente após recusa inicial do microfone', async () => {
    vi.mocked(abrirMicrofone).mockResolvedValueOnce({ ok: false, motivo: 'permissao-negada' })
    montar()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na sessão online' }))
    await screen.findByRole('alert')
    expect(conectarChamada).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reconectar sessão online' }))
    await waitFor(() => expect(conectarChamada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('repassa as duas trilhas apenas quando a chamada está conectada e silencia a trilha original', async () => {
    const onStreams = vi.fn(), onState = vi.fn()
    montar({ ...props, onStreams, onState })
    await entrar()
    const callbacks = vi.mocked(conectarChamada).mock.calls[0]![0]
    await act(async () => callbacks.receber(remoto))
    expect(onStreams).not.toHaveBeenCalled()
    await act(async () => callbacks.estado('conectada'))
    expect(onStreams).toHaveBeenCalledWith(local, remoto)
    expect(onState).toHaveBeenCalledWith('conectada')
    expect(screen.getByLabelText('Áudio do outro participante')).toHaveProperty('srcObject', remoto)
    fireEvent.click(screen.getByRole('button', { name: 'Desligar meu microfone' }))
    expect(silenciar).toHaveBeenLastCalledWith(true)
    expect(screen.getByText('Seu microfone está desligado.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ligar meu microfone' }))
    expect(silenciar).toHaveBeenLastCalledWith(false)
  })
  it('aguarda a transcrição final antes de encerrar e liberar as trilhas', async () => {
    let terminar!: () => void
    const antesDeEncerrar = vi.fn(() => new Promise<void>(resolve => { terminar = resolve }))
    montar({ ...props, antesDeEncerrar })
    await entrar()
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar sessão online' }))
    expect(screen.getByRole('button', { name: 'Encerrar sessão online' })).toHaveProperty('disabled', true)
    expect(encerrar).not.toHaveBeenCalled()
    await act(async () => terminar())
    expect(encerrar).toHaveBeenCalledOnce()
    expect(screen.getByRole('status').textContent).toBe('Sessão online encerrada.')
  })
  it('encerra mesmo se o fechamento da transcrição falhar e permite reconhecer o erro', async () => {
    montar({ ...props, antesDeEncerrar: vi.fn().mockRejectedValue(new Error('transcrição')) })
    await entrar()
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar sessão online' }))
    await screen.findByRole('alert')
    expect(encerrar).toHaveBeenCalledOnce()
    expect(screen.getByRole('status').textContent).toBe('Sessão online encerrada.')
  })
  it('retirar consentimento cancela a chamada imediatamente', async () => {
    montar()
    await entrar()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(encerrar).toHaveBeenCalledOnce()
    expect(vi.mocked(conectarChamada).mock.calls[0]![0].signal.aborted).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Sessão online encerrada.')
  })
  it('para microfone cuja permissão terminou depois de desmontar a página', async () => {
    let liberar!: (r: Awaited<ReturnType<typeof abrirMicrofone>>) => void
    vi.mocked(abrirMicrofone).mockImplementationOnce(() => new Promise(resolve => { liberar = resolve }))
    const view = montar()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na sessão online' }))
    view.unmount()
    await act(async () => liberar({ ok: true, microfone }))
    expect(stop).toHaveBeenCalledOnce()
    expect(conectarChamada).not.toHaveBeenCalled()
  })
  it('sai ao desmontar permitindo a volta do participante sem encerrar a sala', async () => {
    const view = montar()
    await entrar()
    view.unmount()
    expect(sair).toHaveBeenCalledOnce()
    expect(encerrar).not.toHaveBeenCalled()
  })
  it('retoma ICE e renova a captura se a conexão antiga não pode ser retomada', async () => {
    montar()
    await entrar()
    await act(async () => vi.mocked(conectarChamada).mock.calls[0]![0].estado('interrompida'))
    fireEvent.click(screen.getByRole('button', { name: 'Reconectar sessão online' }))
    await waitFor(() => expect(reconectar).toHaveBeenCalledOnce())
    reconectar.mockRejectedValueOnce(new Error('socket fechado'))
    fireEvent.click(screen.getByRole('button', { name: 'Reconectar sessão online' }))
    await waitFor(() => expect(conectarChamada).toHaveBeenCalledTimes(2))
    expect(vi.mocked(conectarChamada).mock.calls[0]![0].signal.aborted).toBe(true)
  })
  it('limpa captura e exibe falha de sinalização', async () => {
    vi.mocked(conectarChamada).mockRejectedValueOnce(new Error('convite expirado'))
    montar()
    await entrar()
    await screen.findByRole('alert')
    expect(stop).toHaveBeenCalledOnce()
  })
  it('mantém reprodução manual quando autoplay é recusado e ignora callbacks após sair', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('autoplay'))
    const view = montar()
    await entrar()
    const callbacks = vi.mocked(conectarChamada).mock.calls[0]![0]
    await act(async () => callbacks.receber(remoto))
    expect(screen.getByLabelText('Áudio do outro participante')).toHaveProperty('controls', true)
    act(() => callbacks.falhar())
    expect(screen.getByRole('alert')).toBeTruthy()
    view.unmount()
    await act(async () => { callbacks.estado('conectada'); callbacks.receber(remoto); callbacks.falhar() })
    expect(sair).toHaveBeenCalledOnce()
  })
  it.each(['concluir', 'falhar'])('libera a chamada se a transcrição demorar a %s após sair', async resultado => {
    let concluir!: () => void, rejeitar!: (erro: Error) => void
    const antesDeEncerrar = () => new Promise<void>((resolve, reject) => { concluir = resolve; rejeitar = reject })
    const view = montar({ ...props, antesDeEncerrar })
    await entrar()
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar sessão online' }))
    view.unmount()
    await act(async () => {
      if (resultado === 'concluir') concluir()
      else rejeitar(new Error('interrompida'))
    })
    expect(encerrar).toHaveBeenCalledOnce()
    expect(sair).toHaveBeenCalledOnce()
  })
  it('não volta a pedir o microfone se a reconexão falhar após sair', async () => {
    let rejeitar!: (erro: Error) => void
    reconectar.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeitar = reject }))
    const view = montar()
    await entrar()
    act(() => vi.mocked(conectarChamada).mock.calls[0]![0].estado('interrompida'))
    fireEvent.click(screen.getByRole('button', { name: 'Reconectar sessão online' }))
    view.unmount()
    await act(async () => rejeitar(new Error('rede')))
    expect(abrirMicrofone).toHaveBeenCalledOnce()
  })
  it('recusa permissão tardia depois da retirada de consentimento sem iniciar sinalização', async () => {
    let concluir!: (resultado: Awaited<ReturnType<typeof abrirMicrofone>>) => void
    vi.mocked(abrirMicrofone).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
    montar()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na sessão online' }))
    fireEvent.click(screen.getByRole('checkbox'))
    await act(async () => concluir({ ok: true, microfone }))
    expect(stop).toHaveBeenCalledOnce(); expect(conectarChamada).not.toHaveBeenCalled()
  })
  it('ignora rejeição tardia de permissão após sair', async () => {
    let rejeitar!: (erro: Error) => void
    vi.mocked(abrirMicrofone).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeitar = reject }))
    const view = montar()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na sessão online' }))
    view.unmount()
    await act(async () => rejeitar(new Error('permissão recusada')))
    expect(conectarChamada).not.toHaveBeenCalled()
  })

  it('abre sem erro, sem microfone desligado, sem estado e sem tocar no áudio', () => {
    const onState = vi.fn()
    const view = montar({ ...props, onState })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('Seu microfone está desligado.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Encerrar sessão online' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reconectar sessão online' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Desligar meu microfone' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Chamada online' })).toBeTruthy()
    expect(screen.getByRole('checkbox')).toHaveProperty('disabled', false)
    expect(onState).not.toHaveBeenCalled()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    view.unmount()
  })

  it('desmontar sem ter entrado não falha', () => {
    const view = montar()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(() => view.unmount()).not.toThrow()
  })

  it('só toca o áudio quando chega o fluxo remoto e o solta ao desmontar', async () => {
    const view = montar()
    await entrar()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    const player = screen.getByLabelText('Áudio do outro participante')
    await act(async () => vi.mocked(conectarChamada).mock.calls[0]![0].receber(remoto))
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce()
    expect(player).toHaveProperty('srcObject', remoto)
    view.unmount()
    expect(player).toHaveProperty('srcObject', null)
  })

  it('mostra cada estado com seu texto e só os botões que cabem nele', async () => {
    const microfonePendente = deferred<Awaited<ReturnType<typeof abrirMicrofone>>>()
    vi.mocked(abrirMicrofone).mockReturnValueOnce(microfonePendente.promise)
    montar()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na sessão online' }))
    expect((await screen.findByRole('status')).textContent).toBe('Conectando a sessão online...')
    expect(screen.queryByRole('button', { name: 'Entrar na sessão online' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Desligar meu microfone' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reconectar sessão online' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Encerrar sessão online' })).toBeTruthy()
    await act(async () => microfonePendente.resolve({ ok: true, microfone }))
    await waitFor(() => expect(conectarChamada).toHaveBeenCalled())
    expect(screen.getByRole('status').textContent).toBe('Aguardando o outro participante.')
    expect(screen.getByRole('button', { name: 'Desligar meu microfone' })).toBeTruthy()
    const callbacks = vi.mocked(conectarChamada).mock.calls[0]![0]
    await act(async () => callbacks.estado('conectada'))
    expect(screen.getByRole('status').textContent).toBe('Sessão online conectada.')
    expect(screen.getByRole('button', { name: 'Desligar meu microfone' })).toBeTruthy()
    await act(async () => callbacks.estado('interrompida'))
    expect(screen.getByRole('status').textContent).toBe('Conexão interrompida. Tente reconectar.')
    expect(screen.queryByRole('button', { name: 'Desligar meu microfone' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reconectar sessão online' })).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: 'Encerrar sessão online' })).toHaveProperty('disabled', false)
    expect(screen.getByRole('checkbox')).toHaveProperty('disabled', false)
  })

  it('depois de encerrada a sessão não oferece mais nenhuma ação nem aceita o consentimento de novo', async () => {
    montar()
    await entrar()
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar sessão online' }))
    await screen.findByText('Sessão online encerrada.')
    expect(screen.getByRole('checkbox')).toHaveProperty('disabled', true)
    expect(screen.queryByRole('button', { name: 'Encerrar sessão online' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Entrar na sessão online' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Desligar meu microfone' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('encerra sem esperar transcrição quando ninguém pediu e mesmo enquanto ainda conecta', async () => {
    const microfonePendente = deferred<Awaited<ReturnType<typeof abrirMicrofone>>>()
    vi.mocked(abrirMicrofone).mockReturnValueOnce(microfonePendente.promise)
    montar()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na sessão online' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Encerrar sessão online' }))
    await screen.findByText('Sessão online encerrada.')
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => microfonePendente.resolve({ ok: true, microfone }))
    expect(conectarChamada).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('encerrar sem aviso prévio de transcrição não acende erro', async () => {
    montar()
    await entrar()
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar sessão online' }))
    await screen.findByText('Sessão online encerrada.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(encerrar).toHaveBeenCalledOnce()
  })

  it('não entrega o fluxo conectado quando ninguém escuta', async () => {
    montar()
    await entrar()
    const callbacks = vi.mocked(conectarChamada).mock.calls[0]![0]
    await act(async () => callbacks.receber(remoto))
    await act(async () => callbacks.estado('conectada'))
    expect(screen.getByRole('status').textContent).toBe('Sessão online conectada.')
  })

  it('depois de retirar o consentimento, nada que a chamada avise muda a tela', async () => {
    montar()
    await entrar()
    const callbacks = vi.mocked(conectarChamada).mock.calls[0]![0]
    fireEvent.click(screen.getByRole('checkbox'))
    await act(async () => { callbacks.estado('conectada'); callbacks.receber(remoto); callbacks.falhar() })
    expect(screen.getByRole('status').textContent).toBe('Sessão online encerrada.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Áudio do outro participante')).toHaveProperty('srcObject', null)
  })

  it('uma falha de sinalização que chega depois da retirada do consentimento não acende erro', async () => {
    const sinalizacao = deferred<Awaited<ReturnType<typeof conectarChamada>>>()
    vi.mocked(conectarChamada).mockReturnValueOnce(sinalizacao.promise)
    montar()
    await entrar()
    fireEvent.click(screen.getByRole('checkbox'))
    await act(async () => sinalizacao.reject(new Error('convite expirado')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Sessão online encerrada.')
  })

  it('reconectar com a chamada viva limpa o erro mostrado', async () => {
    montar()
    await entrar()
    const callbacks = vi.mocked(conectarChamada).mock.calls[0]![0]
    await act(async () => { callbacks.estado('interrompida'); callbacks.falhar() })
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reconectar sessão online' }))
    await waitFor(() => expect(reconectar).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('enquanto finaliza a transcrição não deixa reconectar', async () => {
    let terminar!: () => void
    const antesDeEncerrar = vi.fn(() => new Promise<void>((resolve) => { terminar = resolve }))
    montar({ ...props, antesDeEncerrar })
    await entrar()
    await act(async () => vi.mocked(conectarChamada).mock.calls[0]![0].estado('interrompida'))
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar sessão online' }))
    expect(screen.getByRole('button', { name: 'Reconectar sessão online' })).toHaveProperty('disabled', true)
    await act(async () => terminar())
  })
})
