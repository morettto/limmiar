import { Link } from '@tanstack/react-router'
import { Trans } from '@lingui/react/macro'
import { useSession } from '../../entities/account/session-context'

// ponytail: this <div id="app-shell"> is a navigation stub, not a real landing page --
// replace it together with the real landing page, not as a standalone cleanup.
export function HomePage() {
  const { sessao, terminarSessao } = useSession()
  const email = sessao?.email ?? null
  return (
    <div id="app-shell">
      Limmiar
      <Link to="/settings/copilot">
        <Trans>Configurar copiloto de IA</Trans>
      </Link>
      {email !== null ? (
        <>
          <span data-testid="conta-sessao">{email}</span>
          <button type="button" onClick={terminarSessao}>
            <Trans>Sair</Trans>
          </button>
        </>
      ) : null}
    </div>
  )
}
