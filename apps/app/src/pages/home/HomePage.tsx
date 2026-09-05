import { Link } from '@tanstack/react-router'
import { Trans } from '@lingui/react/macro'

export interface HomePageProps {
  email: string | null
  onSair: () => void
}

// ponytail: this <div id="app-shell"> is a navigation stub, not a real landing page --
// replace it together with the real landing page, not as a standalone cleanup.
export function HomePage({ email, onSair }: HomePageProps) {
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
    </div>
  )
}
