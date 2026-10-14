import { useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { PairPrimaryDevice } from '../../features/device-pairing-primary/PairPrimaryDevice'
import { deriveAccountKekForTransfer } from '../../entities/account/account-keys'

export interface PairPrimaryPageProps {
  baseUrl: string
  accountId: string
  accessToken: string
  email: string
  kek: CryptoKey
}

export function PairPrimaryPage({ baseUrl, accountId, accessToken, email, kek }: PairPrimaryPageProps) {
  const [password, setPassword] = useState('')
  const [started, setStarted] = useState(false)
  return <main className="settings-page">
    <header><h1><Trans>Parear novo dispositivo</Trans></h1></header>
    {started ? <PairPrimaryDevice baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} getKekForTransfer={async () => {
      const secret = password
      setPassword('')
      return deriveAccountKekForTransfer(secret, email, kek)
    }} /> : <section className="editorial-card">
      <p><Trans>Abra sua conta no outro dispositivo. Sua chave será liberada somente depois de conferir os códigos nos dois dispositivos.</Trans></p>
      <form onSubmit={event => { event.preventDefault(); setStarted(true) }}>
        <label><Trans>Senha atual</Trans><input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button type="submit"><Trans>Gerar código de pareamento</Trans></button>
      </form>
    </section>}
  </main>
}
