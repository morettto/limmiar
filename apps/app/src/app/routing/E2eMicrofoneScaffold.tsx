import { useState } from 'react'
import { abrirMicrofone, type AbrirMicrofoneResult } from '../../features/live-session/microfone'
import type { EstadoConsentimento } from '../../entities/consentimento/api'

// Andaime de e2e, nunca produção: existe só para consentimento-microfone.spec.ts clicar "Gravar"
// com um consentimento conhecido e ler no DOM o que `abrirMicrofone` devolveu, sem inventar UI
// real. Vive num ficheiro próprio, e não dentro de router.tsx, por duas razões: o router volta a
// ser tabela de rotas em vez de ganhar um componente com estado, e a copy visível daqui fica fora
// do portão de i18n (ver a entrada deste caminho em eslint.config.mjs) sem que isso abra exceção
// nenhuma a copy de produto.
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
