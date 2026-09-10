import { Link } from '@tanstack/react-router'
import { Trans } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import type { SessaoAgendada } from '../../entities/agenda/sessao'
import type { Nota } from '../../entities/nota/nota'
import { PainelProfissional } from '../../widgets/painel-profissional/PainelProfissional'

// ponytail: baseUrl continua fixture -- mesmo motivo e mesmo upgrade natural do
// BASE_URL_FIXTURE de pages/notas/NotaPage.tsx (não entra em nenhuma guarda, promovê-lo a
// prop não muda cobertura nem comportamento enquanto accessToken/kek também são fixture).
const BASE_URL_FIXTURE = ''

export interface HomePageProps {
  email: string | null
  onSair: () => void
  accountId: string | null
  accessToken: string | null
  /** null = sem KeychainProvider ainda -- o painel monta em "chaveiro bloqueado". */
  kek: CryptoKey | null
  notas: readonly Nota[]
  sessoes: readonly SessaoAgendada[]
}

// ponytail: this <div id="app-shell"> is a navigation stub, not a real landing page --
// replace it together with the real landing page, not as a standalone cleanup.
export function HomePage({ email, onSair, accountId, accessToken, kek, notas, sessoes }: HomePageProps) {
  return (
    <div id="app-shell">
      Limmiar
      <Link to="/settings/copilot">
        <Trans>Configurar copiloto de IA</Trans>
      </Link>
      {email !== null ? (
        <>
          <span data-testid="conta-sessao">{email}</span>
          <button type="button" onClick={onSair}>
            <Trans>Sair</Trans>
          </button>
        </>
      ) : null}
      <PainelProfissional
        baseUrl={BASE_URL_FIXTURE}
        accountId={accountId}
        accessToken={accessToken}
        kek={kek}
        notas={notas}
        sessoes={sessoes}
      />
    </div>
  )
}
