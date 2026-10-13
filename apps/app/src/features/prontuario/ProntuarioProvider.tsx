import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { msg } from '@lingui/core/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { traduzir, type Texto } from '../../shared/i18n'
import { abrirProntuario, type Prontuario } from './abrir-prontuario'
import { ProntuarioContext } from './prontuario-context'

export interface ProntuarioProviderProps {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
  patientId: string
  children: ReactNode
}

type Estado = { status: 'erro'; mensagem: Texto } | { status: 'pronto'; prontuario: Prontuario }

/** Abre o prontuário uma vez por paciente; as páginas filhas só consomem `useProntuario()`. */
export function ProntuarioProvider({ baseUrl, accountId, accessToken, kek, patientId, children }: ProntuarioProviderProps) {
  const { i18n } = useLingui()
  const [estado, setEstado] = useState<Estado | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const ultimoPedido = useRef<object>(null)
  // A renovação do token não pode recarregar a pasta (gravação e nota em andamento).
  const accessTokenRef = useRef(accessToken)
  accessTokenRef.current = accessToken

  const recarregar = useCallback(async () => {
    const pedido = {}
    ultimoPedido.current = pedido
    const prontuario = await abrirProntuario(baseUrl, accountId, accessTokenRef.current, kek, patientId)
    if (pedido === ultimoPedido.current) setEstado({ status: 'pronto', prontuario })
  }, [baseUrl, accountId, kek, patientId])

  useEffect(() => {
    let ativo = true
    setEstado(null)
    recarregar().catch((erro: unknown) => {
      if (ativo) setEstado({ status: 'erro', mensagem: erro instanceof Error ? erro.message : msg`Não foi possível abrir o prontuário.` })
    })
    return () => { ativo = false }
  }, [recarregar, tentativa])

  const contexto = useMemo(() => estado?.status === 'pronto' ? { prontuario: estado.prontuario, recarregar } : null, [estado, recarregar])
  // Stryker disable next-line ArithmeticOperator: equivalent, a retry counter only has to differ from the previous value.
  const tentarNovamente = () => setTentativa(valor => valor + 1)
  if (contexto === null) {
    return estado?.status === 'erro'
      ? <main className="workspace"><p role="alert">{traduzir(i18n, estado.mensagem)}</p><button type="button" onClick={tentarNovamente}><Trans>Tentar novamente</Trans></button></main>
      : <main className="workspace"><p role="status"><Trans>Abrindo prontuário...</Trans></p></main>
  }
  return <ProntuarioContext.Provider value={contexto}>{children}</ProntuarioContext.Provider>
}
