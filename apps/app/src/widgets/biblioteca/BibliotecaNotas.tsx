import { Link } from '@tanstack/react-router'
import { Trans } from '@lingui/react/macro'
import type { GrupoPaciente } from '../../features/nota-biblioteca/biblioteca'
import type { ResultadoBusca } from '../../features/nota-biblioteca/indice'
import { ABA_NOTA } from '../../entities/atendimento/atendimento'
import { ESTADO_ASSINADA } from '../../entities/nota/nota'

export interface BibliotecaNotasProps {
  grupos: readonly GrupoPaciente[]
  nomesPacientes: ReadonlyMap<string, string>
  termo: string
  onTermoChange: (termo: string) => void
  resultado: ResultadoBusca
}

// `a-preparar`/`ocioso` mostram a biblioteca inteira (sem filtro) -- só `pronto` filtra por
// `ids`. Este widget nunca decide o estado da busca (isso é `buscar`, em `indice.ts`, do
// lado do chamador); aqui só aplica o filtro já calculado.
function gruposFiltrados(grupos: readonly GrupoPaciente[], resultado: ResultadoBusca): readonly GrupoPaciente[] {
  if (resultado.estado !== 'pronto') {
    return grupos
  }
  const ids = new Set(resultado.ids)
  return grupos
    .map((grupo) => ({ ...grupo, itens: grupo.itens.filter((item) => ids.has(item.id)) }))
    .filter((grupo) => grupo.itens.length > 0)
}

/**
 * Biblioteca de notas: campo de busca + grupos por paciente, com `resultado` já calculado pelo
 * chamador. Só filtra por `ids` quando `pronto` e só mostra "sem resultados" com `ids` vazio --
 * nunca com `a-preparar`, que confundiria "a carregar" com "sem resultado" (ver README).
 */
export function BibliotecaNotas({ grupos, nomesPacientes, termo, onTermoChange, resultado }: BibliotecaNotasProps) {
  const semResultados = resultado.estado === 'pronto' && resultado.ids.length === 0

  return (
    <div className="workspace-card">
      <label className="mb-2 block">
        <span className="mb-1 block text-sm font-medium">
          <Trans>Buscar notas</Trans>
        </span>
        <input
          type="search"
          value={termo}
          onChange={(event) => onTermoChange(event.target.value)}
          className="w-full rounded-md border border-neutral-300 px-2 py-1"
        />
      </label>
      {resultado.estado === 'a-preparar' && (
        <p role="status">
          <Trans>Preparando a busca...</Trans>
        </p>
      )}
      {semResultados ? (
        <p role="status">
          <Trans>Nenhuma nota encontrada.</Trans>
        </p>
      ) : (
        gruposFiltrados(grupos, resultado).map((grupo) => (
          <section key={grupo.patientId} aria-label={nomesPacientes.get(grupo.patientId)} className="mb-4">
            <h2 className="mb-2 font-semibold">{nomesPacientes.get(grupo.patientId)}</h2>
            <ul className="space-y-4">
              {grupo.itens.map((item, indice) => {
                const numero = indice + 1
                const revisao = item.revisao + 1
                return <li key={item.id} className="paper-card p-4">
                  <h3><Trans>Nota {numero}</Trans></h3>
                  <p>{item.estado === ESTADO_ASSINADA ? <Trans>Assinada</Trans> : <Trans>Rascunho</Trans>}{' — '}<Trans>Revisão {revisao}</Trans></p>
                  <dl>{item.frases.map((frase) => <div key={frase.id} className="my-2">
                    <dt className="font-semibold">{frase.secao}</dt><dd className="whitespace-pre-wrap">{frase.texto}</dd>
                  </div>)}</dl>
                  <Link to="/pacientes/$patientId/sessoes/$atendimentoId" params={{ patientId: item.patientId, atendimentoId: item.atendimentoId }} search={{ aba: ABA_NOTA }}><Trans>Abrir nota {numero}</Trans></Link>
                </li>
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
