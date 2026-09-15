import { useEffect, useState } from 'react'
import type { CryptoKey } from '@limmiar/crypto'
import { Trans } from '@lingui/react/macro'
import type { CheckIn } from '../../entities/checkin/checkin'
import { listarVinculos, type Vinculo } from '../../entities/vinculo/api'
import { garantirParDeChaves } from '../../entities/vinculo/par-de-chaves'
import { listarItensPartilhados } from '../../entities/partilha/api'
import { decifrarItem } from '../../entities/partilha/cifra'
import type { ItemPartilhado } from './partilha'

export interface CheckInsPartilhadosProps {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
}

interface Grupo {
  vinculo: Vinculo
  checkins: CheckIn[]
}

type Carga = { status: 'carregando' | 'erro'; grupos: Grupo[] } | { status: 'pronta'; grupos: Grupo[] }

// Ordem de chegada do servidor preservada por listarItensPartilhados; o último item de um dia
// (por ordem de chegada) vence, então um dia editado e repartilhado nunca aparece duplicado.
function ultimoPorDia(itens: readonly CheckIn[]): CheckIn[] {
  const porDia = new Map(itens.map((checkin) => [checkin.dia, checkin]))
  return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia))
}

async function carregarGrupo(p: {
  baseUrl: string
  accountId: string
  accessToken: string
  privateKey: Uint8Array
  vinculo: Vinculo
}): Promise<Grupo> {
  const itensResultado = await listarItensPartilhados(p.baseUrl, p.accountId, p.accessToken, p.vinculo.pacienteAccountId)
  if (!itensResultado.ok) {
    throw new Error(`CheckInsPartilhados: falha ao listar itens partilhados (${itensResultado.code})`)
  }
  const checkins = itensResultado.itens.map((item) => {
    const decifrado = decifrarItem({
      privadaProfissional: p.privateKey,
      // carregarGrupo só recebe vínculos com chavePublicaDoPar !== null (filtrados no chamador).
      publicaPaciente: p.vinculo.chavePublicaDoPar as Uint8Array,
      pacienteAccountId: p.vinculo.pacienteAccountId,
      profissionalAccountId: p.accountId,
      ciphertext: item.ciphertext,
    })
    if ((decifrado as { tipo?: unknown } | null)?.tipo !== 'checkin') {
      throw new Error('CheckInsPartilhados: envelope decifrado não é um check-in')
    }
    return (decifrado as ItemPartilhado).checkin
  })
  return { vinculo: p.vinculo, checkins: ultimoPorDia(checkins) }
}

async function carregarCarga(p: {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
}): Promise<Carga> {
  const { privateKey } = await garantirParDeChaves(p)
  const vinculosResultado = await listarVinculos(p.baseUrl, p.accountId, p.accessToken)
  if (!vinculosResultado.ok) {
    throw new Error(`CheckInsPartilhados: falha ao listar vínculos (${vinculosResultado.code})`)
  }
  const vinculosDaProfissional = vinculosResultado.vinculos.filter(
    (v) => v.profissionalAccountId === p.accountId && v.chavePublicaDoPar !== null,
  )
  const grupos = await Promise.all(
    vinculosDaProfissional.map((vinculo) =>
      carregarGrupo({ baseUrl: p.baseUrl, accountId: p.accountId, accessToken: p.accessToken, privateKey, vinculo }),
    ),
  )
  return { status: 'pronta', grupos }
}

// Profissional: um grupo por vínculo em que `accountId` é a profissional, com os check-ins que a
// paciente decidiu partilhar, decifrados no dispositivo. Qualquer falha (par de chaves, vínculos
// ou um item) é fail-closed: um alerta genérico, nada decifrado parcialmente é mostrado.
export function CheckInsPartilhados({ baseUrl, accountId, accessToken, kek }: CheckInsPartilhadosProps) {
  const [carga, setCarga] = useState<Carga>({ status: 'carregando', grupos: [] })

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      let proxima: Carga
      try {
        proxima = await carregarCarga({ baseUrl, accountId, accessToken, kek })
      } catch {
        proxima = { status: 'erro', grupos: [] }
      }
      if (!cancelado) {
        setCarga(proxima)
      }
    }
    void carregar()
    return () => {
      cancelado = true
    }
  }, [baseUrl, accountId, accessToken, kek])

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
          {grupo.checkins.length === 0 ? (
            <p>
              <Trans>Nenhum check-in compartilhado.</Trans>
            </p>
          ) : (
            <ul>
              {grupo.checkins.map((checkin) => (
                <li key={checkin.dia}>
                  {checkin.dia}: {checkin.sono}/{checkin.ansiedade}
                  {checkin.frase !== null ? ` · ${checkin.frase}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
