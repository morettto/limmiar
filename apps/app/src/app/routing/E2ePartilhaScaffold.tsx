import { useEffect, useState } from 'react'
import { type CryptoKey, webcrypto } from '@limmiar/crypto'
import { decodeBase64 } from '../../shared/lib/base64'
import { PacienteHojePage } from '../../pages/paciente-hoje/PacienteHojePage'
import { PartilhaCheckIns } from '../../features/partilha/PartilhaCheckIns'
import { CheckInsPartilhados } from '../../features/partilha/CheckInsPartilhados'

export interface E2ePartilhaScaffoldProps {
  baseUrl: string
  accountId: string
  accessToken: string
  // Base64 de uma KEK de teste de 32 bytes -- mesmo precedente de E2eVinculoScaffold.
  kek: string
  papel: string
  // ISO 8601, '' = agora real. Seam para o E2E fixar "hoje" nos dois lados (paciente e
  // profissional) da mesma cena.
  agora: string
}

// Andaime de E2E, nunca produção (mesmo motivo do E2eVinculoScaffold): partilha-checkin.spec.ts
// (S11-02, fatia 7) semeia conta, token e KEK pela query string para alcançar os dois ecrãs de
// partilha sem KeychainProvider nem sessão real.
export function E2ePartilhaScaffold({ baseUrl, accountId, accessToken, kek, papel, agora }: E2ePartilhaScaffoldProps) {
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

  if (kekImportada === null) {
    return null
  }

  if (papel === 'profissional') {
    return (
      <CheckInsPartilhados baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} kek={kekImportada} />
    )
  }

  return (
    <div>
      <PacienteHojePage
        accountId={accountId}
        kek={kekImportada}
        agora={agora === '' ? undefined : new Date(agora)}
        partilha={{ baseUrl, accessToken }}
      />
      <PartilhaCheckIns baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} kek={kekImportada} />
    </div>
  )
}
