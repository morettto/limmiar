import { type CryptoKey, webcrypto } from '@limmiar/crypto'
import { digestNota, serializarFrases, type Nota } from './nota'

// Molde literal de entities/patient/patient-crypto.ts's DEK_AAD_PREFIX/ENTRY_AAD_PREFIX --
// mesmo espaço de nomes "limmiar/<contexto>/v1|...", versão própria por já ser um contexto
// (assinatura de nota) diferente do prontuário do paciente.
const SIGNATURE_AAD_PREFIX = 'limmiar/note-signature/v1|'

export function notaAssinaturaAad(noteId: string, revisao: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${SIGNATURE_AAD_PREFIX}${noteId}|${revisao}`)
}

/** Sela `digestNota(nota)` (não a nota inteira) sob a DEK do paciente -- a assinatura atesta o hash do conteúdo canónico, amarrado a `noteId`+`revisao` via AAD, exatamente como `sealEntry` amarra cada entrada do prontuário a `patientId`+`sequence`. */
export async function selarAssinatura(
  dek: CryptoKey,
  noteId: string,
  nota: Nota,
): Promise<Uint8Array<ArrayBuffer>> {
  return webcrypto.encrypt(dek, await digestNota(nota), notaAssinaturaAad(noteId, nota.revisao))
}

// Serializador dedicado, deliberadamente distinto de `textoCanonico` (nota.ts): `textoCanonico`
// omite `noteId` de propósito, porque é exatamente a superfície que a assinatura cobre; a
// entrada de prontuário precisa de saber a que nota pertence -- é o registo clínico completo,
// não o hash que a assinatura atesta. Fundir os dois obrigaria a assinatura a cobrir campos que
// não são conteúdo clínico (o id da nota), então continuam dois serializadores por responderem
// a perguntas diferentes -- só o map de `frases` é partilhado, via `serializarFrases`.
export function notaParaEntrada(nota: Nota): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify({
      tipo: 'nota',
      noteId: nota.id,
      revisao: nota.revisao,
      frases: serializarFrases(nota.frases),
    }),
  )
}
