import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { generateMnemonic } from '@limmiar/crypto'
import { deriveEmailSalt, deriveRecoveryVerifier, registerRecoveryPhrase } from '../../entities/account'

export interface RecoveryPhraseSetupProps {
  baseUrl: string
  accountId: string
  email: string
  accessToken: string
  onDone: () => void
}

export function RecoveryPhraseSetup({ baseUrl, accountId, email, accessToken, onDone }: RecoveryPhraseSetupProps) {
  const { t } = useLingui()
  const [phrase, setPhrase] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(true)
  const running = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  async function save() {
    if (running.current || phrase === null) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const verifier = await deriveRecoveryVerifier(phrase, await deriveEmailSalt(email))
      try {
        if (!active.current) return
        const result = await registerRecoveryPhrase(baseUrl, accountId, accessToken, verifier)
        if (!active.current) return
        if (!result.ok) throw new Error('Recovery registration failed')
        setPhrase(null)
        onDone()
      } finally { verifier.fill(0) }
    } catch { if (active.current) setError(t`Não foi possível salvar sua frase. Tente novamente.`) }
    finally { running.current = false; if (active.current) setBusy(false) }
  }
  return <section className="editorial-card">
    <h2><Trans>Recuperação do login</Trans></h2>
    <p><Trans>Esta frase recupera somente o login da conta. Ela não substitui a chave pessoal nem os códigos de recuperação dos prontuários.</Trans></p>
    {phrase === null ? <button type="button" onClick={() => setPhrase(generateMnemonic(256))}><Trans>Gerar frase de recuperação</Trans></button> : <>
      <p><Trans>Guarde esta frase em um local seguro. Você também precisará do segundo fator ou de um código de backup para recuperar o acesso.</Trans></p>
      <ol>{phrase.split(' ').map((word, index) => <li key={`${index}-${word}`}>{word}</li>)}</ol>
      <button type="button" disabled={busy} onClick={() => void save()}><Trans>Guardei minha frase</Trans></button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>
}
