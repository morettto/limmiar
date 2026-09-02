import { useState } from 'react'
import { abrirMicrofone, type AbrirMicrofoneResult } from '../../features/live-session/microfone'
import type { EstadoConsentimento } from '../../entities/consentimento/api'

// Andaime de e2e, nunca produção: consentimento-microfone.spec.ts clica "Gravar" e lê no DOM o
// que `abrirMicrofone` devolveu. Ficheiro próprio, e não router.tsx, para o router ficar tabela
// de rotas e a copy daqui ficar fora do portão de i18n (ver eslint.config.mjs).
export function E2eMicrofoneScaffold({ consentimento }: { consentimento: EstadoConsentimento }) {
  const [resultado, setResultado] = useState<AbrirMicrofoneResult | null>(null)

  async function abrir() {
    setResultado(await abrirMicrofone(consentimento))
  }

  return (
    <div>
      <button type="button" onClick={() => void abrir()}>
        Gravar
      </button>
      {resultado !== null && resultado.ok && <p role="status">microfone aberto</p>}
      {resultado !== null && !resultado.ok && <p role="alert">{resultado.motivo}</p>}
    </div>
  )
}
