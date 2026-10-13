import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { abrirEmbedding } from '../../entities/voz/voice-crypto'
import { cadastrarVoz, obterCadastroVoz, removerCadastroVoz } from '../../entities/voz/voice-enrollment'
import { capturarPerfil } from './capturar-perfil'

export interface VoiceSettingsProps {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
}

export function VoiceSettings({ baseUrl, accountId, accessToken, kek }: VoiceSettingsProps) {
  const { i18n, t } = useLingui()
  const [cadastrada, setCadastrada] = useState(false)
  const [ocupado, setOcupado] = useState(true)
  const [cancelavel, setCancelavel] = useState(false)
  const [verificado, setVerificado] = useState(false)
  const [autorizada, setAutorizada] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [mensagem, setMensagem] = useState<MessageDescriptor | null>(null)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    controller.current = abort
    void (async () => {
      try {
        const cadastro = await obterCadastroVoz(baseUrl, accountId, accessToken)
        if (abort.signal.aborted) return
        if (cadastro.ok) {
          const vetor = await abrirEmbedding(kek, accountId, cadastro.wrappedDek, cadastro.sealedEmbedding)
          vetor.fill(0)
          if (!abort.signal.aborted) { setCadastrada(true); setVerificado(true) }
        } else if (cadastro.code !== 'voice.enrollment_not_found') throw new Error()
        else setVerificado(true)
      } catch { if (!abort.signal.aborted) setMensagem(msg`Não foi possível abrir seu perfil de voz. Tente novamente.`) }
      finally { if (!abort.signal.aborted) setOcupado(false) }
    })()
    return () => { abort.abort(); controller.current!.abort() }
  }, [baseUrl, accountId, accessToken, kek])

  async function cadastrar() {
    const abort = new AbortController()
    controller.current!.abort()
    controller.current = abort
    setOcupado(true); setCancelavel(true); setSegundos(0); setMensagem(msg`Preparando o reconhecimento local. Depois, permita o microfone e leia as três linhas.`)
    let vetor: number[] | undefined
    try {
      vetor = await capturarPerfil(abort.signal, (valor) => { if (!abort.signal.aborted) setSegundos(valor) })
      if (abort.signal.aborted) return
      setCancelavel(false)
      setMensagem(msg`Cifrando seu perfil de voz...`)
      const resultado = await cadastrarVoz(baseUrl, accountId, accessToken, kek, vetor)
      if (!resultado.ok) throw new Error(resultado.code)
      if (!abort.signal.aborted) { setCadastrada(true); setVerificado(true); setMensagem(msg`Perfil de voz salvo. Ele será usado nas próximas sessões.`) }
    } catch (erro) {
      // A causa técnica (nome e mensagem do erro) acompanha o texto: sem ela, falhas de navegador e de servidor são indistinguíveis.
      const causa = erro instanceof Error || erro instanceof DOMException ? ` (${erro.name}: ${erro.message})` : ''
      if (!abort.signal.aborted) setMensagem(msg`Não foi possível cadastrar sua voz. Permita o microfone e fale sozinho durante toda a amostra.${causa}`)
    } finally {
      vetor?.fill(0)
      if (!abort.signal.aborted) { setOcupado(false); setCancelavel(false) }
    }
  }

  async function remover() {
    const abort = new AbortController()
    controller.current!.abort(); controller.current = abort
    setOcupado(true); setMensagem(null)
    try {
      const resultado = await removerCadastroVoz(baseUrl, accountId, accessToken)
      if (!resultado.ok) throw new Error()
      if (!abort.signal.aborted) { setCadastrada(false); setMensagem(msg`Perfil de voz removido.`) }
    } catch { if (!abort.signal.aborted) setMensagem(msg`Não foi possível remover seu perfil de voz.`) }
    finally { if (!abort.signal.aborted) setOcupado(false) }
  }

  return <section className="workspace-card" aria-label={t`Seu perfil de voz`}>
    <h2><Trans>Seu perfil de voz</Trans></h2>
    <p><Trans>Leia as três linhas durante 15 segundos, em um lugar silencioso, sem outra pessoa falando.</Trans></p>
    <blockquote className="my-5 border-l-2 border-current pl-4">
      <p><Trans>Minha voz ajuda a organizar a conversa, respeitando o tempo de cada pessoa.</Trans></p>
      <p><Trans>Durante a sessão, escuto com atenção e faço perguntas para compreender melhor.</Trans></p>
      <p><Trans>Este é meu cadastro de voz. As falas do paciente devem permanecer separadas das minhas.</Trans></p>
    </blockquote>
    <p><Trans>O áudio não é salvo nem enviado ao servidor. Apenas seu perfil de voz cifrado é armazenado na conta.</Trans></p>
    {verificado && <p role="status">{cadastrada ? <Trans>Você já tem um perfil de voz.</Trans> : <Trans>Você ainda não tem um perfil de voz.</Trans>}</p>}
    <label><input type="checkbox" disabled={ocupado} checked={autorizada} onChange={(evento) => setAutorizada(evento.target.checked)} /> <Trans>Autorizo o uso do microfone para cadastrar minha voz.</Trans></label>
    <div className="my-4 flex flex-wrap gap-3">
      <button type="button" className="button-primary" disabled={ocupado || !autorizada} onClick={() => void cadastrar()}>{cadastrada ? <Trans>Substituir perfil de voz</Trans> : <Trans>Cadastrar minha voz</Trans>}</button>
      {cadastrada && <button type="button" disabled={ocupado} onClick={() => void remover()}><Trans>Remover perfil de voz</Trans></button>}
      {ocupado && cancelavel && <button type="button" onClick={() => { controller.current!.abort(); setOcupado(false); setCancelavel(false); setMensagem(msg`Cadastro cancelado.`) }}><Trans>Cancelar</Trans></button>}
    </div>
    {ocupado && segundos > 0 && <p role="status"><Trans>Amostra: {segundos} de 15 segundos.</Trans></p>}
    {mensagem !== null && <p role="status">{i18n._(mensagem)}</p>}
  </section>
}
