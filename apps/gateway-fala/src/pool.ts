import type { AbrirUpstream } from './upstream.ts'

export class CapacidadeEsgotada extends Error {}

// Em CPU, um processo do NeMo-Speech serializa as sessões: escala-se com vários processos pequenos, cada um fixo nos seus
// núcleos. Cada sessão vai para o menos ocupado que ainda tem vaga; se ele recusar, tenta o próximo.
export function criarPoolUpstream(abridores: AbrirUpstream[], sessoesPorInstancia: number): AbrirUpstream {
  const ativas = abridores.map(() => 0)
  return async (idioma, aoMensagem, aoFechar) => {
    const livres = abridores.map((_, indice) => indice).filter((indice) => ativas[indice]! < sessoesPorInstancia)
      .sort((a, b) => ativas[a]! - ativas[b]!)
    if (livres.length === 0) throw new CapacidadeEsgotada('Capacidade de transcrição esgotada.')
    let ultimoErro: unknown
    for (const indice of livres) {
      ativas[indice]!++
      let liberada = false
      const liberar = () => { if (!liberada) { liberada = true; ativas[indice]!-- } }
      try {
        const upstream = await abridores[indice]!(idioma, aoMensagem, (erro) => { liberar(); aoFechar(erro) })
        return { ...upstream, fechar: () => { liberar(); upstream.fechar() } }
      } catch (erro) { liberar(); ultimoErro = erro }
    }
    throw ultimoErro
  }
}
