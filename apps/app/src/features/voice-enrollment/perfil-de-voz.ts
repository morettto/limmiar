import type { CryptoKey } from '@limmiar/crypto'
import { abrirEmbedding } from '../../entities/voz/voice-crypto'
import { obterCadastroVoz } from '../../entities/voz/voice-enrollment'

// Válido só se abrir com a KEK atual; outra resposta da API é falha, não ausência.
// Depois do cancelamento, nada é decifrado nem resolvido: só rejeita.
export async function temPerfilDeVoz(baseUrl: string, accountId: string, accessToken: string, kek: CryptoKey, signal: AbortSignal): Promise<boolean> {
  const cadastro = await obterCadastroVoz(baseUrl, accountId, accessToken)
  signal.throwIfAborted()
  if (!cadastro.ok) {
    if (cadastro.code === 'voice.enrollment_not_found') return false
    throw new Error(cadastro.code)
  }
  const vetor = await abrirEmbedding(kek, accountId, cadastro.wrappedDek, cadastro.sealedEmbedding)
  vetor.fill(0)
  signal.throwIfAborted()
  return true
}
