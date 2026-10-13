import { useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { gravarConsentimento, lerConsentimento } from '../../entities/insight/consentimento-voto'

export function ConsentimentoVotos({ accountId }: { accountId: string }) {
  const [enviar, setEnviar] = useState(() => lerConsentimento(accountId) === 'sim')
  return <label className="mx-auto flex max-w-sm items-center gap-2 p-4 text-sm">
    <input type="checkbox" role="switch" checked={enviar} onChange={(evento) => {
      setEnviar(evento.target.checked)
      gravarConsentimento(accountId, evento.target.checked ? 'sim' : 'nao')
    }} />
    <Trans>Enviar meus votos de útil / não útil, sem identificação, para melhorar as sugestões</Trans>
  </label>
}
