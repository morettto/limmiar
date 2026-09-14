import { useEffect, useState } from 'react'
import { type CryptoKey, webcrypto } from '@limmiar/crypto'
import { decodeBase64 } from '../../shared/lib/base64'
import { PacienteHojePage } from '../../pages/paciente-hoje/PacienteHojePage'

// Andaime de E2E, nunca produção (mesmo motivo do E2eMicrofoneScaffold): checkin-diario.spec.ts
// semeia accountId e uma KEK de teste pela query string, sem API nem conta real. `kek` fica
// `null` até `importKek` resolver -- a página já trata isso como "chaveiro bloqueado".
export function E2ePacienteHojeScaffold({ accountId, kek }: { accountId: string; kek: string }) {
  const [kekImportada, setKekImportada] = useState<CryptoKey | null>(null)

  useEffect(() => {
    let cancelado = false
    webcrypto.importKek(decodeBase64(kek)).then((imported) => {
      if (!cancelado) {
        setKekImportada(imported)
      }
    })
    return () => {
      cancelado = true
    }
  }, [kek])

  return <PacienteHojePage accountId={accountId} kek={kekImportada} />
}
