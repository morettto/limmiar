import { diaLocal, serieComLacunas, type CheckIn, type DiaLocal } from '../../entities/checkin/checkin'
import type { SessaoAgendada } from '../../entities/agenda/sessao'

export interface DiaDoEspelho {
  dia: DiaLocal
  checkin: CheckIn | null
  sessoes: readonly SessaoAgendada[]
}

export interface Espelho {
  dias: readonly DiaDoEspelho[]
  diasComCheckIn: number
}

export const DIAS_ESPELHO = 7

// Puro: `serieComLacunas` já resolve a lacuna explícita e ignora checkins fora da janela (o
// `Map` só tem chaves dos `DIAS_ESPELHO` dias pedidos); aqui só se agrupam as sessões por dia
// local de `inicioEm`, filtradas pelo `patientId` do vínculo.
export function montarEspelho(p: {
  checkins: readonly CheckIn[]
  sessoes: readonly SessaoAgendada[]
  patientId: string
  hoje: DiaLocal
}): Espelho {
  const serie = serieComLacunas(p.checkins, p.hoje, DIAS_ESPELHO)
  const sessoesPorDia = new Map<DiaLocal, SessaoAgendada[]>()
  for (const sessao of p.sessoes) {
    if (sessao.patientId !== p.patientId) {
      continue
    }
    const dia = diaLocal(new Date(sessao.inicioEm))
    const lista = sessoesPorDia.get(dia)
    if (lista === undefined) {
      sessoesPorDia.set(dia, [sessao])
    } else {
      lista.push(sessao)
    }
  }

  const dias = serie.map(({ dia, checkin }) => ({ dia, checkin, sessoes: sessoesPorDia.get(dia) ?? [] }))
  const diasComCheckIn = dias.filter((dia) => dia.checkin !== null).length
  return { dias, diasComCheckIn }
}

// Campos locais (ano, mês, dia), como `diasAntes`: `de` = meia-noite de hoje−6, `ate` = amanhã.
// ponytail: numa mudança de hora a janela foge de 7 d e a API rejeita (MaxListWindow); sem DST no
// Brasil desde 2019. Upgrade: `ate = min(ate, de + 7 dias exatos)`.
export function janelaDoEspelho(agora: Date): { de: Date; ate: Date } {
  const ano = agora.getFullYear()
  const mes = agora.getMonth()
  const dia = agora.getDate()
  return { de: new Date(ano, mes, dia - 6), ate: new Date(ano, mes, dia + 1) }
}
