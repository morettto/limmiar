import type { EstadoConsentimento } from '../../entities/consentimento/api'

/** Construtor único: `abrirMicrofone`. Nenhum outro código deve montar este
 *  objeto diretamente (ver invariante em README.md). */
export interface MicrofoneAutorizado {
  readonly stream: MediaStream
}

export type AbrirMicrofoneResult =
  | { ok: true; microfone: MicrofoneAutorizado }
  | { ok: false; motivo: 'consentimento-ausente' | 'permissao-negada' }

/** A ÚNICA porta para `navigator.mediaDevices.getUserMedia` no código de captura ao
 *  vivo (ver invariante em README.md). Recusa sem nunca chamar `getUserMedia`
 *  quando o consentimento de gravação não está `'concedido'`.
 *
 *  ponytail: qualquer rejeição de `getUserMedia` (não só `NotAllowedError`) mapeia
 *  para `'permissao-negada'` -- `AbrirMicrofoneResult` só tem esses dois motivos, e
 *  distinguir `NotFoundError`/`NotReadableError` etc. exigiria um terceiro motivo que
 *  nenhum critério de aceite pede. Upgrade: acrescentar o motivo e ramificar por
 *  `erro.name` no dia em que a UI precisar de os distinguir. */
export async function abrirMicrofone(
  consentimentoGravacao: EstadoConsentimento,
  midia: MediaDevices = navigator.mediaDevices,
): Promise<AbrirMicrofoneResult> {
  if (consentimentoGravacao !== 'concedido') {
    return { ok: false, motivo: 'consentimento-ausente' }
  }

  try {
    const stream = await midia.getUserMedia({ audio: true })
    return { ok: true, microfone: { stream } }
  } catch {
    return { ok: false, motivo: 'permissao-negada' }
  }
}
