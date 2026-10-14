import { falhaDe, type FalhaInsight } from './falha-insight'
import type { ConsultaInsight, ResultadoInsight } from './insight'

const ESPERA_INICIAL_MS = 1000
const ESPERA_MAXIMA_MS = 30_000

export function criarFilaInsights(
  consultar: (consulta: ConsultaInsight, signal: AbortSignal, atualizar: (resultado: ResultadoInsight) => void, cursor?: string) => Promise<ResultadoInsight>,
  atualizar: (id: string, resultado: ResultadoInsight | null, consulta: ConsultaInsight) => void,
  falhar: (falha: FalhaInsight, consulta: ConsultaInsight) => void,
) {
  let consultas = new Map<string, ConsultaInsight>()
  const pendentes = new Map<string, ConsultaInsight>()
  const concluidas = new Map<string, string>()
  const progresso = new Map<string, ResultadoInsight>()
  let emCurso = false
  let encerrada = false
  let foraSeguidas = 0
  let abort: AbortController | undefined
  let ativa: ConsultaInsight | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const chave = (consulta: ConsultaInsight) => JSON.stringify(consulta)
  const proxima = () => pendentes.values().next().value
  function agendar(espera = 500) {
    if (encerrada || emCurso || timer !== undefined) return
    timer = setTimeout(() => { timer = undefined; void executar() }, espera)
  }
  async function executar() {
    const consulta = proxima()
    if (!consulta || encerrada) return
    pendentes.delete(consulta.id)
    emCurso = true
    const controller = new AbortController()
    abort = controller
    ativa = consulta
    const original = chave(consulta)
    const anterior = progresso.get(consulta.id)
    const juntar = (resultado: ResultadoInsight) => ({ ...resultado,
      cartoes: [...new Map([...(anterior?.cartoes ?? []), ...resultado.cartoes].map((fonte) => [fonte.trecho_id, fonte])).values()] })
    const vigente = () => !encerrada && !controller.signal.aborted && consultas.has(consulta.id) && chave(consultas.get(consulta.id)!) === original
    try {
      const resultado = await consultar(consulta, controller.signal, (parcial) => {
        if (vigente()) atualizar(consulta.id, juntar(parcial), consulta)
      }, anterior?.cursor)
      foraSeguidas = 0
      if (vigente()) {
        if (!resultado.completo && resultado.cursor === anterior?.cursor) throw new Error('Consulta sem avanço.')
        const acumulado = juntar(resultado)
        progresso.delete(consulta.id)
        if (resultado.completo) concluidas.set(consulta.id, original)
        else { progresso.set(consulta.id, acumulado); pendentes.set(consulta.id, consulta) }
        atualizar(consulta.id, acumulado, consulta)
      }
    } catch (erro) {
      if (vigente()) {
        const falha = falhaDe(erro)
        if (falha === 'fora') {
          foraSeguidas++
          pendentes.set(consulta.id, consulta)
        } else {
          foraSeguidas = 0
          progresso.delete(consulta.id); concluidas.set(consulta.id, original); atualizar(consulta.id, null, consulta)
        }
        falhar(falha, consulta)
      }
    } finally {
      emCurso = false; ativa = undefined
      agendar(foraSeguidas === 0 ? 0 : Math.min(ESPERA_INICIAL_MS * 2 ** (foraSeguidas - 1), ESPERA_MAXIMA_MS))
    }
  }
  return {
    atualizar(novas: ConsultaInsight[]) {
      if (encerrada) return
      const seguintes = new Map(novas.map((consulta) => [consulta.id, consulta]))
      for (const [id, anterior] of consultas) {
        if (!seguintes.has(id) || chave(seguintes.get(id)!) !== chave(anterior)) {
          atualizar(id, null, anterior)
          concluidas.delete(id)
          progresso.delete(id)
          pendentes.delete(id)
        }
      }
      consultas = seguintes
      for (const consulta of novas) {
        const mesmaAtiva = ativa?.id === consulta.id && chave(ativa) === chave(consulta)
        if (!mesmaAtiva && concluidas.get(consulta.id) !== chave(consulta) && !pendentes.has(consulta.id)) pendentes.set(consulta.id, consulta)
      }
      if (ativa && (!consultas.has(ativa.id) || chave(consultas.get(ativa.id)!) !== chave(ativa))) abort?.abort()
      agendar()
    },
    encerrar() { encerrada = true; clearTimeout(timer); abort?.abort(); progresso.clear(); pendentes.clear(); consultas.clear(); concluidas.clear() },
  }
}
