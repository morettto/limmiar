import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Turno } from './roteiro'

// Plano da carga com o copiloto real: um profissional por tema, as 5 obras mais usadas pelas sessões do tema
// no acervo dele, e as primeiras sessões do tema, cortadas nos primeiros minutos do diálogo.

export const RAIZ = fileURLToPath(new URL('../../../../../', import.meta.url))
const SESSOES = join(RAIZ, '.local/simulacao-100/sessoes')
export const SAIDA = join(RAIZ, '.local/simulacao-laya/e2e-ui')
export const TEMAS = ['trauma', 'depressao', 'luto', 'ansiedade_panico', 'toc', 'insonia'] as const
const SESSOES_POR_TEMA = 5
const OBRAS_POR_TEMA = 5
const MINUTOS = 6
// Mesmas durações de montarAtendimentoDe, para cortar o diálogo no tempo de áudio que ele vai gerar.
const duracaoS = (texto: string) => Math.max(3, texto.split(/\s+/).length * 0.36 + 0.4) + 0.9

export interface Obra { pmcid: string; path: string; title: string; authors: string[] }
export interface Profissional { tema: string; obras: Obra[] }
export interface SessaoDaCarga { id: string; tema: string; ordem: number; turnos: Turno[] }

interface Cenario { id: string; theme: string; sources: Obra[]; turns: { role: string; text: string }[] }

export function planoDaCarga(): { profissionais: Profissional[]; sessoes: SessaoDaCarga[] } {
  const cenarios = readdirSync(SESSOES).filter((pasta) => existsSync(join(SESSOES, pasta, 'scenario.json'))).sort()
    .map((pasta) => JSON.parse(readFileSync(join(SESSOES, pasta, 'scenario.json'), 'utf8')) as Cenario)
  const profissionais: Profissional[] = []
  const sessoes: SessaoDaCarga[] = []
  for (const tema of TEMAS) {
    const doTema = cenarios.filter((cenario) => cenario.theme === tema)
    const uso = new Map<string, { obra: Obra; vezes: number }>()
    for (const obra of doTema.flatMap((cenario) => cenario.sources)) {
      const atual = uso.get(obra.pmcid) ?? { obra, vezes: 0 }
      uso.set(obra.pmcid, { obra, vezes: atual.vezes + 1 })
    }
    const obras = [...uso.values()].sort((a, b) => b.vezes - a.vezes || a.obra.pmcid.localeCompare(b.obra.pmcid)).slice(0, OBRAS_POR_TEMA)
    profissionais.push({ tema, obras: obras.map(({ obra }) => obra) })
    doTema.slice(0, SESSOES_POR_TEMA).forEach((cenario, ordem) => {
      let relogio = 0
      const turnos: Turno[] = []
      for (const turno of cenario.turns) {
        relogio += duracaoS(turno.text)
        if (relogio > MINUTOS * 60) break
        turnos.push({ quem: turno.role === 'Paciente' ? 'paciente' : 'profissional', texto: turno.text })
      }
      sessoes.push({ id: cenario.id, tema, ordem, turnos })
    })
  }
  return { profissionais, sessoes }
}
