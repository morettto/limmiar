import { t } from '@lingui/core/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { abrirEmbedding } from '../../entities/voz/voice-crypto'
import { obterCadastroVoz } from '../../entities/voz/voice-enrollment'

// A impressão de voz do profissional só é decifrada aqui, no aparelho, e vai ao gateway de fala na abertura da sessão (WebSocket
// com TLS). Quem recebe o vetor é dono dele e o apaga ao encerrar. Sem cadastro, devolve null: saber quem fala é obrigatório.
export async function abrirPerfilDeVoz(baseUrl: string, accountId: string, accessToken: string, kek: CryptoKey,
  signal: AbortSignal): Promise<number[] | null> {
  const cadastro = await obterCadastroVoz(baseUrl, accountId, accessToken)
  if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
  if (!cadastro.ok) {
    if (cadastro.code === 'voice.enrollment_not_found') return null
    throw new Error(t`Não foi possível abrir seu perfil de voz. Tente novamente.`)
  }
  const perfil = await abrirEmbedding(kek, accountId, cadastro.wrappedDek, cadastro.sealedEmbedding)
  if (signal.aborted) {
    perfil.fill(0)
    throw new DOMException('Cancelado', 'AbortError')
  }
  return perfil
}
