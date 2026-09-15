import { useEffect, useState } from 'react'
import type { CryptoKey } from '@limmiar/crypto'
import { Trans, useLingui } from '@lingui/react/macro'
import { diaLocal, serieComLacunas, type CheckIn, type Nivel } from '../../entities/checkin/checkin'
import { guardarCheckIn, lerCheckIns } from '../../entities/checkin/checkin-store'
import { partilharCheckIn } from '../../features/partilha/partilhar-checkin'

export interface PacienteHojePageProps {
  accountId: string | null
  /** null = chaveiro bloqueado; a página não mostra formulário nem faz nenhuma leitura. */
  kek: CryptoKey | null
  agora?: Date
  /** ausente = S11-01 intacto, zero pedido de rede; presente = partilha um check-in salvo com quem o toggle já autoriza. */
  partilha?: { baseUrl: string; accessToken: string }
}

const DIAS_SERIE = 7
const NIVEIS: readonly Nivel[] = [1, 2, 3, 4, 5]

type Estado = { status: 'idle' } | { status: 'salvo' } | { status: 'salvo-sem-partilha' } | { status: 'erro' }

function NivelFieldset({
  titulo,
  name,
  valor,
  onEscolher,
}: {
  titulo: string
  name: string
  valor: Nivel | null
  onEscolher: (nivel: Nivel) => void
}) {
  return (
    <fieldset>
      <legend>{titulo}</legend>
      {NIVEIS.map((nivel) => (
        <label key={nivel}>
          <input type="radio" name={name} checked={valor === nivel} onChange={() => onEscolher(nivel)} />
          {nivel}
        </label>
      ))}
    </fieldset>
  )
}

export function PacienteHojePage({ accountId, kek, agora = new Date(), partilha }: PacienteHojePageProps) {
  const { t } = useLingui()
  const [sono, setSono] = useState<Nivel | null>(null)
  const [ansiedade, setAnsiedade] = useState<Nivel | null>(null)
  const [frase, setFrase] = useState('')
  const [estado, setEstado] = useState<Estado>({ status: 'idle' })
  const [serie, setSerie] = useState<ReadonlyArray<{ dia: string; checkin: CheckIn | null }>>([])

  const hoje = diaLocal(agora)

  useEffect(() => {
    if (kek === null || accountId === null) {
      return
    }
    let cancelado = false
    lerCheckIns(kek, accountId)
      .then((checkins) => {
        if (!cancelado) {
          setSerie(serieComLacunas(checkins, hoje, DIAS_SERIE))
        }
      })
      .catch(() => {
        if (!cancelado) {
          setEstado({ status: 'erro' })
        }
      })
    return () => {
      cancelado = true
    }
  }, [kek, accountId, hoje])

  if (kek === null || accountId === null) {
    return (
      <p role="status">
        <Trans>Chaveiro bloqueado. Desbloqueie para registrar o check-in de hoje.</Trans>
      </p>
    )
  }

  const unlockedKek = kek
  const realAccountId = accountId

  async function guardar() {
    if (sono === null || ansiedade === null) {
      return
    }
    try {
      const checkin: CheckIn = { dia: hoje, sono, ansiedade, frase: frase === '' ? null : frase }
      await guardarCheckIn(unlockedKek, realAccountId, checkin)
      const checkins = await lerCheckIns(unlockedKek, realAccountId)
      setSerie(serieComLacunas(checkins, hoje, DIAS_SERIE))
      if (partilha === undefined) {
        setEstado({ status: 'salvo' })
        return
      }
      // Decisão do momento da gravação, sem retentativa: o check-in local já ficou salvo acima
      // mesmo que a partilha falhe (ver features/partilha/README.md).
      try {
        await partilharCheckIn({ ...partilha, accountId: realAccountId, kek: unlockedKek, checkin })
        setEstado({ status: 'salvo' })
      } catch {
        setEstado({ status: 'salvo-sem-partilha' })
      }
    } catch {
      setEstado({ status: 'erro' })
    }
  }

  return (
    <div>
      <h1>
        <Trans>Hoje: como você está agora?</Trans>
      </h1>
      {estado.status === 'erro' ? (
        <p role="alert">
          <Trans>Não foi possível salvar o check-in. Tente novamente.</Trans>
        </p>
      ) : null}
      <NivelFieldset titulo={t`Sono`} name="sono" valor={sono} onEscolher={setSono} />
      <NivelFieldset titulo={t`Ansiedade`} name="ansiedade" valor={ansiedade} onEscolher={setAnsiedade} />
      <label htmlFor="checkin-frase">
        <Trans>Uma frase (opcional)</Trans>
      </label>
      <textarea id="checkin-frase" value={frase} onChange={(event) => setFrase(event.target.value)} />
      <button type="button" onClick={() => void guardar()}>
        {t`Guardar`}
      </button>
      {estado.status === 'salvo' ? <p role="status">{t`Guardado`}</p> : null}
      {estado.status === 'salvo-sem-partilha' ? (
        <p role="status">
          <Trans>Check-in salvo neste dispositivo, mas não foi compartilhado.</Trans>
        </p>
      ) : null}
      <ol>
        {serie.map((entrada) => (
          <li key={entrada.dia}>
            {entrada.dia}: {entrada.checkin === null ? t`sem registo` : `${entrada.checkin.sono}/${entrada.checkin.ansiedade}`}
          </li>
        ))}
      </ol>
    </div>
  )
}
