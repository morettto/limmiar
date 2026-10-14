import { Trans } from '@lingui/react/macro'
import { OnlineCall } from '../../features/online-call/OnlineCall'

export function OnlineSessionPage({ baseUrl }: { baseUrl: string }) {
  const fragmento = new URLSearchParams(location.hash.slice(1))
  // A chave ausente vira 'null', que nenhum dos padrões abaixo aceita.
  // eslint-disable-next-line lingui/no-unlocalized-strings -- URL capability keys are part of the invitation protocol.
  const [roomId, token] = [String(fragmento.get('room')), String(fragmento.get('token'))]
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(roomId) || !/^[a-f0-9]{64}$/i.test(token)) return <main className="settings-page">
    <h1><Trans>Sessão online</Trans></h1><p role="alert"><Trans>Convite inválido. Solicite um novo link ao profissional.</Trans></p>
  </main>
  const papel = 'patient' as const
  return <main className="settings-page"><header><h1>Limmiar</h1></header>
    <OnlineCall baseUrl={baseUrl} roomId={roomId} token={token} papel={papel} />
  </main>
}
