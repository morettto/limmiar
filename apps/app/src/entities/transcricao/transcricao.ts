import type { PalavraAtribuida, RotuloLocutor } from '@limmiar/diarization'

export interface Transcricao {
  id: string
  patientId: string
  revisao: number
  autorId: string
  registradaEm: string
  palavras: PalavraAtribuida[]
  papeis: Record<string, RotuloLocutor>
}

export function transcricaoParaEntrada(transcricao: Transcricao): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ tipo: 'transcricao', transcriptId: transcricao.id,
    revisao: transcricao.revisao, autorId: transcricao.autorId, registradaEm: transcricao.registradaEm,
    palavras: transcricao.palavras.map(({ texto, inicioMs, fimMs, locutor }) => ({ texto, inicioMs, fimMs, locutor })),
    papeis: Object.fromEntries(Object.entries(transcricao.papeis).sort(([a], [b]) => a.localeCompare(b))) }))
}

export function lerTranscricao(bytes: Uint8Array<ArrayBuffer>, patientId: string): Transcricao | null {
  let body: unknown
  try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
  if (typeof body !== 'object' || body === null || !('tipo' in body) || body.tipo !== 'transcricao' ||
      !('transcriptId' in body) || typeof body.transcriptId !== 'string' || body.transcriptId.trim() === '' ||
      !('revisao' in body) || typeof body.revisao !== 'number' || !Number.isSafeInteger(body.revisao) || body.revisao < 0 ||
      !('autorId' in body) || typeof body.autorId !== 'string' || body.autorId.trim() === '' ||
      !('registradaEm' in body) || typeof body.registradaEm !== 'string' || !Number.isFinite(Date.parse(body.registradaEm)) ||
      !('papeis' in body) || typeof body.papeis !== 'object' || body.papeis === null || Array.isArray(body.papeis) ||
      !Object.values(body.papeis).every((papel) => papel === 'voce' || papel === 'paciente') ||
      !('palavras' in body) || !Array.isArray(body.palavras) || body.palavras.length === 0) return null
  const papeis = body.papeis as Record<string, RotuloLocutor>
  if (!body.palavras.every((p: unknown) => typeof p === 'object' && p !== null &&
      'texto' in p && typeof p.texto === 'string' && p.texto.trim() !== '' &&
      'inicioMs' in p && typeof p.inicioMs === 'number' && Number.isFinite(p.inicioMs) && p.inicioMs >= 0 &&
      'fimMs' in p && typeof p.fimMs === 'number' && Number.isFinite(p.fimMs) && p.fimMs >= p.inicioMs &&
      'locutor' in p && typeof p.locutor === 'string' && Object.hasOwn(papeis, p.locutor))) return null
  return { id: body.transcriptId, patientId, revisao: body.revisao, autorId: body.autorId, registradaEm: body.registradaEm,
    palavras: body.palavras.map(({ texto, inicioMs, fimMs, locutor }: PalavraAtribuida) => ({ texto, inicioMs, fimMs, locutor })), papeis }
}
