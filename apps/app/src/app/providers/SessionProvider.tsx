import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Trans } from '@lingui/react/macro'
import { logoutSession, refreshSession, type Account } from '../../entities/account'
import { sessaoDaConta } from '../../entities/account/session'
import { SessionContext } from '../../entities/account/session-context'
import { purgarConta } from './purgar-conta'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Account | null>(() => sessaoDaConta.ler())
  const [kek, setKek] = useState<CryptoKey | null>(null)
  const [falhaSaida, setFalhaSaida] = useState(false)
  const [revogando, setRevogando] = useState(false)
  const revogacoesPendentes = useRef(new Set<string>())
  const revogacoesAtivas = useRef(new Set<string>())

  const revogar = useCallback(async (token: string) => {
    if (revogacoesAtivas.current.has(token)) return
    revogacoesPendentes.current.add(token)
    revogacoesAtivas.current.add(token)
    setRevogando(true)
    try {
      const resultado = await logoutSession(import.meta.env.VITE_API_BASE_URL ?? '', token)
      if (!resultado.ok) throw new Error('Session revocation failed')
      revogacoesPendentes.current.delete(token)
      if (revogacoesPendentes.current.size === 0) setFalhaSaida(false)
    } catch { setFalhaSaida(true) }
    finally {
      revogacoesAtivas.current.delete(token)
      setRevogando(revogacoesAtivas.current.size > 0)
    }
  }, [])

  // Uma camada de memoização, não três (S18-14): as duas funções só dependiam de `sessao`.
  // Alvo da purga é `sessao` (estado), não `sessaoDaConta.ler()`, que degrada para `null` em
  // storage corrompido e saltaria a purga em silêncio (ver README).
  const value = useMemo(() => {
    const iniciarSessao = (account: Account, key?: CryptoKey) => {
      if (key?.extractable) throw new Error('The account KEK must be non-extractable')
      sessaoDaConta.registar(account)
      if (sessao !== null && sessao.id !== account.id) {
        void purgarConta(sessao.id)
        void revogar(sessao.refreshToken!)
      }
      setSessao(account)
      setKek(key ?? null)
    }
    const terminarSessao = () => {
      sessaoDaConta.terminar()
      setSessao(null)
      setKek(null)
      if (sessao !== null) {
        void purgarConta(sessao.id)
        void revogar(sessao.refreshToken!)
      }
    }
    return { sessao, kek, iniciarSessao, terminarSessao }
  }, [sessao, kek, revogar])

  useEffect(() => {
    if (sessao === null) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const result = await refreshSession(import.meta.env.VITE_API_BASE_URL ?? '', sessao!.refreshToken!)
        if (cancelled) return
        if (!result.ok) {
          if (result.code === 'auth.refresh_token_invalid') value.terminarSessao()
          else timer = setTimeout(() => void refresh(), 15000)
          return
        }
        const { accessToken, refreshToken, accessTokenExpiresAt } = result
        const renewed = { ...sessao!, accessToken, refreshToken, accessTokenExpiresAt }
        sessaoDaConta.registar(renewed)
        setSessao(renewed)
      } catch {
        if (!cancelled) timer = setTimeout(() => void refresh(), 15000)
      }
    }
    timer = setTimeout(() => void refresh(), Math.min(2 ** 31 - 1, Math.max(0, Date.parse(sessao.accessTokenExpiresAt!) - Date.now() - 60000)))
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sessao, value.terminarSessao])

  return <SessionContext.Provider value={value}>
    {falhaSaida && <div className="workspace-card" role="alert">
      <p><Trans>Você saiu neste dispositivo. Não foi possível encerrar a sessão no servidor.</Trans></p>
      <button type="button" disabled={revogando} onClick={() => {
        for (const token of revogacoesPendentes.current) void revogar(token)
      }}><Trans>Tentar encerrar no servidor novamente</Trans></button>
    </div>}
    {children}
  </SessionContext.Provider>
}
