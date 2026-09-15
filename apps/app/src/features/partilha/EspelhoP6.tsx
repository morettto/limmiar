import { useEffect, useState } from 'react'
import type { CryptoKey } from '@limmiar/crypto'
import { Trans, useLingui } from '@lingui/react/macro'
import { diaLocal, type CheckIn } from '../../entities/checkin/checkin'
import { listarVinculos, type Vinculo } from '../../entities/vinculo/api'
import { garantirParDeChaves } from '../../entities/vinculo/par-de-chaves'
import { listarItensPartilhados } from '../../entities/partilha/api'
import { decifrarItem } from '../../entities/partilha/cifra'
import { listarSessoes } from '../../entities/agenda/api'
import { horaDaSessao, type SessaoAgendada } from '../../entities/agenda/sessao'
import { janelaDoEspelho, montarEspelho, type Espelho } from './espelho'
import type { ItemPartilhado } from './partilha'

export interface EspelhoP6Props {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
  agora?: Date
}

interface Grupo {
  vinculo: Vinculo
  espelho: Espelho
}

// Três ramos, não `{ status: 'carregando' | 'erro' }` combinado: TS não estreita
// progressivamente um discriminante que já é união dentro de um único ramo (2 `if` sequenciais
// deixam `grupos`/`sessoesFalharam` inacessíveis no terceiro).
type Carga =
  | { status: 'carregando' }
  | { status: 'erro' }
  | { status: 'pronta'; grupos: Grupo[]; sessoesFalharam: boolean }

// Isolada da falha dos sinais (chaves/vínculos/envelope, fail-closed): a agenda nunca lança para
// fora, devolve `falhou` e a lista vazia -- o mesmo padrão do PainelProfissional.
async function carregarSessoes(p: {
  baseUrl: string
  accountId: string
  accessToken: string
  agora: Date
}): Promise<{ sessoes: SessaoAgendada[]; falhou: boolean }> {
  try {
    const janela = janelaDoEspelho(p.agora)
    const resultado = await listarSessoes(p.baseUrl, p.accountId, p.accessToken, janela.de, janela.ate)
    return resultado.ok ? { sessoes: resultado.sessoes, falhou: false } : { sessoes: [], falhou: true }
  } catch {
    return { sessoes: [], falhou: true }
  }
}

async function carregarCheckins(p: {
  baseUrl: string
  accountId: string
  accessToken: string
  privateKey: Uint8Array
  vinculo: Vinculo
}): Promise<{ vinculo: Vinculo; checkins: CheckIn[] }> {
  const itensResultado = await listarItensPartilhados(p.baseUrl, p.accountId, p.accessToken, p.vinculo.pacienteAccountId)
  if (!itensResultado.ok) {
    throw new Error(`EspelhoP6: falha ao listar itens partilhados (${itensResultado.code})`)
  }
  const checkins = itensResultado.itens.map((item) => {
    const decifrado = decifrarItem({
      privadaProfissional: p.privateKey,
      // carregarCheckins só recebe vínculos com chavePublicaDoPar !== null (filtrados no chamador).
      publicaPaciente: p.vinculo.chavePublicaDoPar as Uint8Array,
      pacienteAccountId: p.vinculo.pacienteAccountId,
      profissionalAccountId: p.accountId,
      ciphertext: item.ciphertext,
    })
    if ((decifrado as { tipo?: unknown } | null)?.tipo !== 'checkin') {
      throw new Error('EspelhoP6: envelope decifrado não é um check-in')
    }
    return (decifrado as ItemPartilhado).checkin
  })
  return { vinculo: p.vinculo, checkins }
}

async function carregarCarga(p: {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
  agora: Date
}): Promise<Carga> {
  const { privateKey } = await garantirParDeChaves(p)
  const vinculosResultado = await listarVinculos(p.baseUrl, p.accountId, p.accessToken)
  if (!vinculosResultado.ok) {
    throw new Error(`EspelhoP6: falha ao listar vínculos (${vinculosResultado.code})`)
  }
  const vinculosDaProfissional = vinculosResultado.vinculos.filter(
    (v) => v.profissionalAccountId === p.accountId && v.chavePublicaDoPar !== null,
  )

  // A agenda tem o seu próprio `.catch` (dentro de `carregarSessoes`); os grupos não -- uma falha
  // aí (vínculos, chaves ou um envelope) continua fail-closed pelo `try/catch` do chamador.
  const [sessoesResultado, gruposDeCheckins] = await Promise.all([
    carregarSessoes({ baseUrl: p.baseUrl, accountId: p.accountId, accessToken: p.accessToken, agora: p.agora }),
    Promise.all(
      vinculosDaProfissional.map((vinculo) =>
        carregarCheckins({ baseUrl: p.baseUrl, accountId: p.accountId, accessToken: p.accessToken, privateKey, vinculo }),
      ),
    ),
  ])

  const hoje = diaLocal(p.agora)
  const grupos = gruposDeCheckins.map(({ vinculo, checkins }) => ({
    vinculo,
    espelho: montarEspelho({ checkins, sessoes: sessoesResultado.sessoes, patientId: vinculo.patientId, hoje }),
  }))
  return { status: 'pronta', grupos, sessoesFalharam: sessoesResultado.falhou }
}

// Profissional: um grupo por vínculo com os últimos 7 dias (lacuna explícita) dos check-ins que a
// paciente partilhou, decifrados no dispositivo, e as sessões marcadas no dia local de início.
// Fail-closed em chaves/vínculos/envelope (alerta geral); a agenda falha isolada (alerta próprio).
export function EspelhoP6({ baseUrl, accountId, accessToken, kek, agora }: EspelhoP6Props) {
  const { i18n, t } = useLingui()
  // `momento` congela no mount (como a árvore de chamada pede): um `agora` de teste não deve
  // reabrir a janela a cada re-render.
  const [momento] = useState(() => agora ?? new Date())
  const [carga, setCarga] = useState<Carga>({ status: 'carregando' })

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      let proxima: Carga
      try {
        proxima = await carregarCarga({ baseUrl, accountId, accessToken, kek, agora: momento })
      } catch {
        proxima = { status: 'erro' }
      }
      if (!cancelado) {
        setCarga(proxima)
      }
    }
    void carregar()
    return () => {
      cancelado = true
    }
  }, [baseUrl, accountId, accessToken, kek, momento])

  if (carga.status === 'carregando') {
    return null
  }

  if (carga.status === 'erro') {
    return (
      <p role="alert">
        <Trans>Não foi possível carregar os check-ins compartilhados.</Trans>
      </p>
    )
  }

  if (carga.grupos.length === 0) {
    return (
      <p>
        <Trans>Nenhum check-in compartilhado.</Trans>
      </p>
    )
  }

  return (
    <div>
      {carga.grupos.map((grupo) => (
        <section key={grupo.vinculo.pacienteAccountId}>
          <h2>{grupo.vinculo.patientId}</h2>
          <p>
            <Trans>Check-in compartilhado em {grupo.espelho.diasComCheckIn} de 7 dias</Trans>
          </p>
          <ol aria-label={t`Últimos 7 dias`}>
            {grupo.espelho.dias.map((dia) => (
              <li key={dia.dia}>
                {dia.checkin === null ? (
                  <>
                    {dia.dia}: <Trans>sem check-in</Trans>
                  </>
                ) : (
                  <>
                    {dia.dia}: {dia.checkin.sono}/{dia.checkin.ansiedade}
                    {dia.checkin.frase !== null ? ` · ${dia.checkin.frase}` : ''}
                  </>
                )}
                {dia.sessoes.map((sessao) => (
                  <span key={sessao.sessionId}>
                    {' '}
                    · <Trans>Sessão às {horaDaSessao(sessao.inicioEm, i18n.locale)}</Trans>
                  </span>
                ))}
              </li>
            ))}
          </ol>
        </section>
      ))}
      {carga.sessoesFalharam && (
        <p role="alert">
          <Trans>Não foi possível carregar as sessões.</Trans>
        </p>
      )}
    </div>
  )
}
