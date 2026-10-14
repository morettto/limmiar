import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { webcrypto } from '@limmiar/crypto'
import { PairNewDevice } from '../../features/device-pairing-new/PairNewDevice'

export interface PairNewPageProps {
  baseUrl: string
  onUnlocked: (kek: CryptoKey) => void
}

export function PairNewPage({ baseUrl, onUnlocked }: PairNewPageProps) {
  const [text, setText] = useState('')
  const [scan, setScan] = useState<{ decode?: () => Promise<string> } | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  // Stryker disable next-line BooleanLiteral: equivalent, the effect below sets the flag before any async work.
  const active = useRef(true)
  // Stryker disable next-line ArrayDeclaration: equivalent, any constant dependency list runs the effect once.
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const adopt = useCallback(async (bytes: Uint8Array) => {
    const raw = new Uint8Array(bytes)
    try {
      const key = await webcrypto.importKek(raw)
      if (active.current) { onUnlocked(key); setUnlocked(true) }
    } finally { raw.fill(0) }
  }, [onUnlocked])
  function usarCodigo(event: React.FormEvent) {
    event.preventDefault()
    const payload = text.trim()
    // Stryker disable next-line StringLiteral: equivalent, the form unmounts right after, so the cleared text is never rendered.
    setText('')
    setScan({ decode: () => Promise.resolve(payload) })
  }
  return <main className="settings-page">
    <header><h1><Trans>Desbloquear este dispositivo</Trans></h1></header>
    {unlocked ? <section className="editorial-card"><p role="status"><Trans>Prontuários desbloqueados neste dispositivo.</Trans></p></section>
      : scan ? <PairNewDevice baseUrl={baseUrl} decode={scan.decode} onKekAdopted={adopt} />
      : <section className="editorial-card">
        <p><Trans>No dispositivo já desbloqueado, abra Parear novo dispositivo. Escaneie o QR ou cole o código de pareamento.</Trans></p>
        <button type="button" onClick={() => setScan({})}><Trans>Escanear código QR</Trans></button>
        <form onSubmit={usarCodigo}>
          <label><Trans>Código de pareamento</Trans><textarea required value={text} onChange={event => setText(event.target.value)} /></label>
          <button type="submit" disabled={!text.trim()}><Trans>Usar código de pareamento</Trans></button>
        </form>
      </section>}
  </main>
}
