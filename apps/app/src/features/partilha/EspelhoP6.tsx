import { useEffect, useState } from 'react'
import type { CryptoKey } from '@limmiar/crypto'
import { Trans, useLingui } from '@lingui/react/macro'
import { diaLocal, type CheckIn } from '../../entities/checkin/checkin'
import { garantirParDeChaves } from '../../entities/vinculo/par-de-chaves'
import { listarPartilhasRecebidas, type PartilhaRecebida } from '../../entities/partilha/api'
import { decifrarItem } from '../../entities/partilha/cifra'
import { listarSessoes } from '../../entities/agenda/api'
import { horaDaSessao, type SessaoAgendada } from '../../entities/agenda/sessao'
import { janelaDoEspelho, montarEspelho, type Espelho } from './espelho'

export interface EspelhoP6Props {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
  agora?: Date
}

interface Grupo {
  partilha: PartilhaRecebida
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

// carregarPartilha só recebe partilhas com chavePublicaDoPar !== null (filtradas no chamador) --
// sem envelope de rede aqui: listarPartilhasRecebidas já trouxe os itens numa única chamada.
function carregarPartilha(p: {
  accountId: string
  privateKey: Uint8Array
  partilha: PartilhaRecebida & { chavePublicaDoPar: Uint8Array }
}): { partilha: PartilhaRecebida; checkins: CheckIn[] } {
  const publicaPaciente = p.partilha.chavePublicaDoPar
  const checkins = p.partilha.itens.map((item) => {
    const decifrado = decifrarItem({
      privadaProfissional: p.privateKey,
      publicaPaciente,
      pacienteAccountId: p.partilha.pacienteAccountId,
      profissionalAccountId: p.accountId,
      ciphertext: item.ciphertext,
    })
    if (String(decifrado.tipo) !== 'checkin') {
      throw new Error('EspelhoP6: envelope decifrado não é um check-in')
    }
    return decifrado.checkin
  })
  return { partilha: p.partilha, checkins }
}

async function carregarCarga(p: {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
  agora: Date
}): Promise<Carga> {
  const { privateKey } = await garantirParDeChaves(p)

  // A agenda tem o seu próprio `.catch` (dentro de `carregarSessoes`); as partilhas não -- uma
  // falha aí (chaves, listagem ou um envelope) continua fail-closed pelo `try/catch` do chamador.
  const [sessoesResultado, partilhasResultado] = await Promise.all([
    carregarSessoes({ baseUrl: p.baseUrl, accountId: p.accountId, accessToken: p.accessToken, agora: p.agora }),
    listarPartilhasRecebidas(p.baseUrl, p.accountId, p.accessToken),
  ])
  if (!partilhasResultado.ok) {
    throw new Error(`EspelhoP6: falha ao listar partilhas recebidas (${partilhasResultado.code})`)
  }
  const partilhasComChave = partilhasResultado.partilhas.filter(
    (partilha): partilha is PartilhaRecebida & { chavePublicaDoPar: Uint8Array } => partilha.chavePublicaDoPar !== null,
  )

  const hoje = diaLocal(p.agora)
  const grupos = partilhasComChave
    .map((partilha) => carregarPartilha({ accountId: p.accountId, privateKey, partilha }))
    .map(({ partilha, checkins }) => ({
      partilha,
      espelho: montarEspelho({ checkins, sessoes: sessoesResultado.sessoes, patientId: partilha.patientId, hoje }),
    }))
  return { status: 'pronta', grupos, sessoesFalharam: sessoesResultado.falhou }
}

// Profissional: um grupo por paciente já vinculada (ativa ou não) com os últimos 7 dias (lacuna
// explícita) dos check-ins que ela partilhou, decifrados no dispositivo, e as sessões marcadas no
// dia local de início. Fail-closed em chaves/partilhas/envelope (alerta geral); agenda isolada.
export function EspelhoP6({ baseUrl, accountId, accessToken, kek, agora }: EspelhoP6Props) {
  const { i18n, t } = useLingui()
  // `momento` congela no mount (como a árvore de chamada pede): um `agora` de teste não deve
  // reabrir a janela a cada re-render.
  const [momento] = useState(() => agora ?? new Date())
  const [carga, setCarga] = useState<Carga>({ status: 'carregando' })

  useEffect(() => {
    const controller = new AbortController()
    async function carregar() {
      let proxima: Carga
      try {
        proxima = await carregarCarga({ baseUrl, accountId, accessToken, kek, agora: momento })
      } catch {
        proxima = { status: 'erro' }
      }
      if (!controller.signal.aborted) {
        setCarga(proxima)
      }
    }
    void carregar()
    return () => {
      controller.abort()
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
      {carga.grupos.map((grupo) => {
        const { diasComCheckIn, dias } = grupo.espelho
        return (
        <section key={grupo.partilha.pacienteAccountId}>
          <h2>{grupo.partilha.patientId}</h2>
          <p>
            <Trans>Check-in compartilhado em {diasComCheckIn} de 7 dias</Trans>
          </p>
          <ol aria-label={t`Últimos 7 dias`}>
            {dias.map((dia) => (
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
                {dia.sessoes.map((sessao) => {
                  const inicio = horaDaSessao(sessao.inicioEm, i18n.locale)
                  return <span key={sessao.sessionId}>
                    {' '}
                    · <Trans>Sessão às {inicio}</Trans>
                  </span>
                })}
              </li>
            ))}
          </ol>
        </section>
          )
      })}
      {carga.sessoesFalharam && (
        <p role="alert">
          <Trans>Não foi possível carregar as sessões.</Trans>
        </p>
      )}
    </div>
  )
}
