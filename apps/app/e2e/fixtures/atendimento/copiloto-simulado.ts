import type { Page } from '@playwright/test'
import { FALAS_PACIENTE, type TipoFala } from './roteiro'

// FRONTEIRA SIMULADA: o copiloto (/copiloto/api/*: acervo local e juiz) não roda no E2E. O app
// monta os pedidos de verdade; as respostas abaixo são as que o juiz v2 deveria dar a cada tipo de fala.

export interface Cartao {
  trecho_id: string
  titulo: string
  autor: string
  pagina: number
  paragrafo: number
  citacao_literal: string
  fenomeno_na_fala: string
  fenomeno_no_trecho: string
  probabilidade: number
  nivel: 'forte' | 'possivel'
}

function cartao(id: string, obra: 'A' | 'B', pagina: number, paragrafo: number, probabilidade: number, citacao: string): Cartao {
  return {
    trecho_id: id, titulo: `Obra sintética ${obra} de verificação`, autor: `Autor Sintético ${obra}`, pagina, paragrafo,
    citacao_literal: citacao, fenomeno_na_fala: 'evitação', fenomeno_no_trecho: 'evitação de estímulos associados ao evento',
    probabilidade, nivel: probabilidade >= 0.99 ? 'forte' : 'possivel',
  }
}

export const RESPOSTAS: Record<TipoFala, { cartoes: Cartao[]; alerta_risco: boolean }> = {
  clinica: { alerta_risco: false, cartoes: [
    cartao('sint-a-41-2', 'A', 41, 2, 0.995, 'Citação sintética A sobre evitação após um evento, sem validade clínica.'),
    cartao('sint-b-118-1', 'B', 118, 1, 0.991, 'Citação sintética B sobre ativação fisiológica diante de lembranças, sem validade clínica.'),
    cartao('sint-a-57-4', 'A', 57, 4, 0.94, 'Citação sintética A, possível, sobre medo ao dirigir, sem validade clínica.'),
    cartao('sint-b-203-3', 'B', 203, 3, 0.91, 'Citação sintética B, possível, sobre sintomas somáticos, sem validade clínica.'),
  ] },
  negacao: { alerta_risco: false, cartoes: [cartao('sint-a-77-1', 'A', 77, 1, 0.92, 'Citação sintética A, possível, sobre remissão de crises, sem validade clínica.')] },
  terceiro: { alerta_risco: false, cartoes: [] },
  neutra: { alerta_risco: false, cartoes: [] },
  figurada: { alerta_risco: false, cartoes: [] },
  risco: { alerta_risco: true, cartoes: [] },
}

export interface ConsultaRecebida {
  frase: string
  falante: string
  materialIds: string[]
  comAutorizacao: boolean
  em: number
}

export interface CopilotoSimulado {
  consultas: ConsultaRecebida[]
  votosEnviados: string[]
  preparados(): string[]
}

const semAcento = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export async function simularCopiloto(page: Page): Promise<CopilotoSimulado> {
  const preparados = new Map<string, string>()
  const acompanhamentos = new Map<string, number>()
  const estado: CopilotoSimulado = { consultas: [], votosEnviados: [], preparados: () => [...preparados.keys()] }
  await page.route('**/copiloto/api/**', async (route) => {
    const pedido = route.request()
    const { pathname } = new URL(pedido.url())
    const acervo = /\/copiloto\/api\/acervo\/[^/]+(?:\/([^/]+)(\/preparar)?)?$/.exec(pathname)
    if (acervo) {
      const [, materialId, preparar] = acervo
      if (pedido.method() === 'POST' && materialId && preparar) {
        const sha256 = /name="sha256"\r\n\r\n([0-9a-f]{64})/.exec(pedido.postDataBuffer()?.toString('latin1') ?? '')?.[1]
        if (!sha256) return route.fulfill({ status: 400 })
        preparados.set(materialId, sha256)
        acompanhamentos.set(materialId, 0)
        return route.fulfill({ status: 202, json: { materialId, ready: false, sha256, stage: 'aguardando' } })
      }
      if (pedido.method() === 'DELETE' && materialId) { preparados.delete(materialId); return route.fulfill({ status: 204 }) }
      return route.fulfill({ json: { materials: [...preparados].map(([materialId, sha256]) => {
        const consulta = (acompanhamentos.get(materialId) ?? 0) + 1
        acompanhamentos.set(materialId, consulta)
        if (consulta <= 2) return { materialId, ready: false, sha256, stage: 'organizando',
          progress: { phase: consulta === 1 ? 'leitura' : 'referencias', completed: consulta === 1 ? 1 : 8, total: consulta === 1 ? 2 : 24 } }
        return { materialId, ready: true, sha256, paragraphs: 12, preparedAt: new Date().toISOString() }
      }) } })
    }
    if (pathname.endsWith('/votos')) {
      estado.votosEnviados.push(pedido.postData() ?? '')
      return route.fulfill({ status: 204 })
    }
    if (pathname.endsWith('/consultar-qualificado')) {
      const corpo = pedido.postDataJSON() as { frase: string; falante: string; materialIds?: string[] }
      estado.consultas.push({ frase: corpo.frase, falante: corpo.falante, materialIds: corpo.materialIds ?? [],
        comAutorizacao: pedido.headers().authorization?.startsWith('Bearer ') ?? false, em: Date.now() })
      const fala = FALAS_PACIENTE.find((candidata) => semAcento(candidata.texto) === semAcento(corpo.frase))
      const resposta = fala ? RESPOSTAS[fala.tipo] : { cartoes: [], alerta_risco: false }
      return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ ...resposta, clarificar: false, completo: true, juiz: 'v2' }) + '\n' })
    }
    return route.fulfill({ status: 404 })
  })
  return estado
}
