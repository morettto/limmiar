import { useEffect, useState } from 'react'
import type { CryptoKey } from '@limmiar/crypto'
import { Trans } from '@lingui/react/macro'
import { listarVinculos, type Vinculo } from '../../entities/vinculo/api'
import { lerEstadoPartilha, definirPartilha } from '../../entities/partilha/preferencias'
import type { EstadoPartilha } from '../../entities/partilha/partilha'
import { chaveDoVinculo } from './partilha'

export interface PartilhaCheckInsProps {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
}

type Status = 'carregando' | 'pronta' | 'erro-leitura'

interface Carga {
  status: Status
  vinculos: Vinculo[]
  partilha: EstadoPartilha
}

async function carregarEstado(p: {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
}): Promise<Carga> {
  const vinculosResultado = await listarVinculos(p.baseUrl, p.accountId, p.accessToken)
  if (!vinculosResultado.ok) {
    return { status: 'erro-leitura', vinculos: [], partilha: {} }
  }
  const vinculosDaPaciente = vinculosResultado.vinculos.filter((v) => v.pacienteAccountId === p.accountId)
  try {
    const { estado } = await lerEstadoPartilha(p)
    return { status: 'pronta', vinculos: vinculosDaPaciente, partilha: estado }
  } catch {
    return { status: 'erro-leitura', vinculos: vinculosDaPaciente, partilha: {} }
  }
}

function TextoDoEstado({ ativa }: { ativa: boolean }) {
  if (ativa) {
    return (
      <p>
        <Trans>Os check-ins que você registrar a partir de agora são compartilhados com esta profissional.</Trans>
      </p>
    )
  }
  return (
    <p role="status">
      <Trans>
        Compartilhamento de check-ins desativado. O que muda: os check-ins que você registrar a partir de agora não
        são compartilhados. O que não muda: os check-ins já compartilhados continuam com a profissional, que pode já
        tê-los lido, e a Limmiar não consegue apagá-los. O vínculo continua ativo.
      </Trans>
    </p>
  )
}

// Paciente: um checkbox por vínculo, ligado ao blob de preferências versionado do servidor.
// Falha de leitura é fail-closed (checkbox desativada); falha de escrita não é otimista -- o
// checkbox é controlado só pelo estado confirmado pelo servidor, então "reverte" sozinho.
export function PartilhaCheckIns({ baseUrl, accountId, accessToken, kek }: PartilhaCheckInsProps) {
  const [carga, setCarga] = useState<Carga>({ status: 'carregando', vinculos: [], partilha: {} })
  const [pendentes, setPendentes] = useState<Record<string, boolean>>({})
  const [erros, setErros] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelado = false
    carregarEstado({ baseUrl, accountId, accessToken, kek }).then((proxima) => {
      if (!cancelado) {
        setCarga(proxima)
      }
    })
    return () => {
      cancelado = true
    }
  }, [baseUrl, accountId, accessToken, kek])

  async function handleToggle(vinculo: Vinculo, ativa: boolean) {
    const chave = chaveDoVinculo(vinculo)
    setPendentes((atual) => ({ ...atual, [chave]: true }))
    setErros((atual) => ({ ...atual, [chave]: false }))
    try {
      const novoEstado = await definirPartilha({ baseUrl, accountId, accessToken, kek, chave, tipo: 'checkin', ativa })
      setCarga((atual) => ({ ...atual, partilha: novoEstado }))
    } catch {
      setErros((atual) => ({ ...atual, [chave]: true }))
    } finally {
      setPendentes((atual) => ({ ...atual, [chave]: false }))
    }
  }

  if (carga.status === 'carregando') {
    return null
  }

  return (
    <div>
      {carga.status === 'erro-leitura' ? (
        <p role="alert">
          <Trans>
            Não foi possível carregar suas preferências de compartilhamento. Nada novo será compartilhado até que
            elas carreguem.
          </Trans>
        </p>
      ) : null}
      <ul>
        {carga.vinculos.map((vinculo) => {
          const chave = chaveDoVinculo(vinculo)
          const ativa = carga.partilha[chave]?.checkin === true
          return (
            <li key={chave}>
              <label>
                <input
                  type="checkbox"
                  checked={ativa}
                  disabled={carga.status === 'erro-leitura' || pendentes[chave] === true}
                  onChange={() => void handleToggle(vinculo, !ativa)}
                />
                <Trans>Compartilhar check-ins com esta profissional</Trans>
              </label>
              {carga.status === 'pronta' ? <TextoDoEstado ativa={ativa} /> : null}
              {erros[chave] === true ? (
                <p role="alert">
                  <Trans>Não foi possível salvar sua preferência de compartilhamento. Tente novamente.</Trans>
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
