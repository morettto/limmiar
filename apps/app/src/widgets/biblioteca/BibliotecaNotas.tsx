import { Trans } from '@lingui/react/macro'
import type { GrupoPaciente } from '../../features/nota-biblioteca/biblioteca'
import type { ResultadoBusca } from '../../features/nota-biblioteca/indice'

export interface BibliotecaNotasProps {
  grupos: readonly GrupoPaciente[]
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
  return grupos.map((grupo) => ({ ...grupo, itens: grupo.itens.filter((item) => ids.has(item.id)) }))
}

/**
 * Biblioteca de notas: campo de busca + grupos por paciente. `resultado` já vem calculado
 * do chamador (`buscar`, `features/nota-biblioteca/indice.ts`) -- este widget só faz três
 * coisas: mostra "a preparar" sem esconder os grupos, filtra por `ids` quando `pronto`, e só
 * mostra "sem resultados" quando `ids` vier vazio (nunca com `a-preparar`, que confundiria
 * "índice ainda a carregar" com "busca sem resultado" -- ver README, "os três estados").
 */
export function BibliotecaNotas({ grupos, termo, onTermoChange, resultado }: BibliotecaNotasProps) {
  const semResultados = resultado.estado === 'pronto' && resultado.ids.length === 0

  return (
    <div>
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
          <section key={grupo.patientId} aria-label={grupo.patientId} className="mb-4">
            <h2 className="mb-2 font-semibold">{grupo.patientId}</h2>
            <ul>
              {grupo.itens.map((item) => (
                <li key={item.id}>{item.id}</li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
