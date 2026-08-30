import type { EstadoConsentimento } from '../../entities/consentimento/api'

// Marca nominal. `declare const` de um `unique symbol` não exportado: não existe em runtime
// e nenhum outro módulo lhe consegue nomear a chave, portanto a tipagem estrutural do
// TypeScript deixa de aceitar um `{ stream }` montado à mão como `MicrofoneAutorizado`.
declare const marcaMicrofoneAutorizado: unique symbol

/** Construtor único: `abrirMicrofone`. Montar este objeto fora daqui não compila -- a
 *  invariante da porta única é do compilador, não da convenção (ver README.md). */
export interface MicrofoneAutorizado {
  readonly stream: MediaStream
  readonly [marcaMicrofoneAutorizado]: true
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
    return { ok: true, microfone: { stream } as MicrofoneAutorizado }
  } catch {
    return { ok: false, motivo: 'permissao-negada' }
  }
}
