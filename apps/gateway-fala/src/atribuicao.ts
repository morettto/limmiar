import { LIMIAR_MESMA_VOZ, similaridadeCosseno } from '@limmiar/diarization'
import type { Extrator } from './extrator.ts'
import type { Locutores } from './locutores.ts'
import { AMOSTRAS_POR_MS, type Falante } from './protocolo.ts'

export interface TrechoDeVoz { inicioMs: number; fimMs: number; falante: Falante | null }

export function falanteNoInstante(trechos: TrechoDeVoz[], instanteMs: number): Falante | null {
  const presentes = trechos.filter(trecho => trecho.inicioMs <= instanteMs && instanteMs < trecho.fimMs)
  return presentes.length === 1 ? presentes[0]!.falante : null
}

export async function atribuirVozes(pcm: Float32Array, inicioMs: number, minimoMs: number,
  extrator: Extrator, locutores: Locutores): Promise<TrechoDeVoz[]> {
  const vozes = new Map<number, { primeira: Float32Array; segunda: Float32Array | null }>()
  try {
    const segmentos = await extrator.segmentar(pcm.slice())
    const amostrasMinimas = Math.round(minimoMs * AMOSTRAS_POR_MS)
    for (const [indice, segmento] of segmentos.entries()) {
      const de = Math.round(segmento.start * 1000 * AMOSTRAS_POR_MS)
      const ate = Math.round(segmento.end * 1000 * AMOSTRAS_POR_MS)
      // Rótulos locais não confirmam identidade; sobreposição não pode ensinar nenhuma das vozes.
      if (segmentos.some(outro => outro !== segmento && outro.start < segmento.end && outro.end > segmento.start)) continue
      const audio = pcm.subarray(de, ate)
      if (audio.length < amostrasMinimas) continue
      let primeira: Float32Array | null = null
      let segunda: Float32Array | null = null
      try {
        primeira = await extrator.embutir(audio.slice(0, amostrasMinimas))
        segunda = audio.length >= amostrasMinimas * 2 ? await extrator.embutir(audio.slice(-amostrasMinimas)) : null
        if (primeira && (audio.length < amostrasMinimas * 2 || segunda)) vozes.set(indice, { primeira, segunda })
        else { primeira?.fill(0); segunda?.fill(0) }
      } catch (erro) { primeira?.fill(0); segunda?.fill(0); throw erro }
    }
    const falantes = new Map<number, Falante | null>()
    for (const [speaker, { primeira, segunda }] of vozes) {
      if (segunda && similaridadeCosseno([...primeira], [...segunda]) < LIMIAR_MESMA_VOZ) { falantes.set(speaker, null); continue }
      const conhecida = locutores.reconhecer(primeira)
      const confirmada = segunda ? locutores.reconhecer(segunda) : conhecida
      falantes.set(speaker, conhecida !== null && conhecida === confirmada ? locutores.identificar(primeira, segunda ?? undefined) : null)
    }
    for (const [speaker, { primeira, segunda }] of vozes) {
      if (segunda && similaridadeCosseno([...primeira], [...segunda]) >= LIMIAR_MESMA_VOZ &&
        locutores.reconhecer(primeira) === locutores.reconhecer(segunda)) {
        falantes.set(speaker, locutores.identificar(primeira, segunda))
      }
    }
    return segmentos.map((segmento, indice) => ({ inicioMs: inicioMs + segmento.start * 1000,
      fimMs: inicioMs + segmento.end * 1000, falante: falantes.get(indice) ?? null }))
  } finally {
    pcm.fill(0)
    for (const voz of vozes.values()) { voz.primeira.fill(0); voz.segunda?.fill(0) }
  }
}
