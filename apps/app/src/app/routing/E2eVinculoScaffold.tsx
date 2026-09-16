import { useEffect, useState } from 'react'
import { type CryptoKey, webcrypto } from '@limmiar/crypto'
import { decodeBase64 } from '../../shared/lib/base64'
import { GerarConviteVinculo } from '../../features/vinculo/GerarConviteVinculo'
import { ResgatarConviteVinculo } from '../../features/vinculo/ResgatarConviteVinculo'
import { DesvincularVinculo } from '../../features/vinculo/DesvincularVinculo'

export interface E2eVinculoScaffoldProps {
  baseUrl: string
  accountId: string
  accessToken: string
  // Base64 de uma KEK de teste de 32 bytes -- mesmo precedente de E2ePacienteHojeScaffold.
  kek: string
  papel: string
  patientId: string
}

// Andaime de E2E, nunca produção (mesmo motivo do E2ePacienteHojeScaffold): não há
// KeychainProvider ainda, então vinculo-chave-publica.spec.ts semeia conta, token e KEK pela
// query string em vez de destrancar um chaveiro real.
export function E2eVinculoScaffold({ baseUrl, accountId, accessToken, kek, papel, patientId }: E2eVinculoScaffoldProps) {
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

  return (
    <div>
      {papel === 'Professional' ? (
        <GerarConviteVinculo
          baseUrl={baseUrl}
          accountId={accountId}
          accessToken={accessToken}
          kek={kekImportada}
          patientId={patientId}
        />
      ) : (
        <ResgatarConviteVinculo baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} kek={kekImportada} />
      )}
      <DesvincularVinculo baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} />
    </div>
  )
}
