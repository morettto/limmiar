import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useSession } from '../../entities/account/session-context'
import { getVault, saveVault, type VaultAccount } from '../../entities/clinical-vault/api'
import { createVault, recoverVault, unlockVault, type PreparedVault, type VaultDocument } from '../../entities/clinical-vault/crypto'
import './clinical-vault.css'

type Recovery = { expectedRevision: string; recoveryId: string; recoveryVerifier: string }
type Step = 'loading' | 'unavailable' | 'create' | 'unlock' | 'recover'

export function ClinicalVaultGate({ children }: { children: ReactNode }) {
  const { sessao, kek, desbloquearProntuarios, terminarSessao } = useSession()
  if (sessao?.role !== 'Professional' || !sessao.accessToken || kek !== null) return children
  return <VaultScreen key={sessao.id} account={{ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '', accountId: sessao.id, accessToken: sessao.accessToken }}
    onUnlocked={key => desbloquearProntuarios(sessao.id, key)} onExit={terminarSessao} />
}

export function VaultScreen({ account, onUnlocked, onExit }: {
  account: VaultAccount; onUnlocked: (key: CryptoKey) => void; onExit: () => void
}) {
  const { t } = useLingui()
  const { baseUrl, accountId, accessToken } = account
  // eslint-disable-next-line lingui/no-unlocalized-strings -- internal state, never displayed.
  const [step, setStep] = useState<Step>('loading')
  const [document, setDocument] = useState<VaultDocument | null>(null)
  const [prepared, setPrepared] = useState<PreparedVault | null>(null)
  const [recovery, setRecovery] = useState<Recovery | undefined>()
  const [secret, setSecret] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const active = useRef(true)
  const running = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => { heading.current?.focus() }, [step, prepared])
  useEffect(() => {
    let cancelled = false
    void getVault({ baseUrl, accountId, accessToken }).then(document => {
      if (cancelled) return
      setDocument(document)
      // eslint-disable-next-line lingui/no-unlocalized-strings -- internal state, never displayed.
      setStep(document === null ? 'create' : 'unlock')
    }).catch(() => {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- internal state, never displayed.
      if (!cancelled) setStep('unavailable')
    })
    return () => { cancelled = true }
  }, [baseUrl, accountId, accessToken])

  async function run(operation: () => Promise<void>, failure: string) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try { await operation() }
    catch { if (active.current) setError(failure) }
    finally { running.current = false; if (active.current) setBusy(false) }
  }

  function kit(value: PreparedVault): string {
    return `${t`Limmiar — kit de acesso aos prontuários`}\n\n${t`Chave pessoal`}\n${value.key}\n\n${t`Códigos de recuperação`}\n${value.recoveryCodes.join('\n')}\n\n${t`Guarde este kit fora do Limmiar. Sem a chave e sem os códigos, os dados não podem ser recuperados.`}`
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const input = secret
    setSecret('')
    await run(async () => {
      if (step === 'recover') {
        const result = await recoverVault(account.accountId, input, document!)
        if (!active.current) return
        setPrepared(result.prepared)
        setRecovery({ expectedRevision: document!.revision, recoveryId: result.recoveryId, recoveryVerifier: result.recoveryVerifier })
      } else {
        const key = await unlockVault(account.accountId, input, document!)
        if (active.current) onUnlocked(key)
      }
    }, step === 'recover' ? t`Código inválido. Confira o código de recuperação e tente novamente.` : t`Chave inválida. Confira sua chave pessoal e tente novamente.`)
  }

  return <main className="vault-page" aria-busy={busy}>
    <div className="vault-brand">Limmiar</div>
    <section className="vault-panel">
      <p className="editorial-eyebrow"><Trans>Seu espaço privado</Trans></p>
      <h1 ref={heading} tabIndex={-1}>{prepared ? t`Guarde seu acesso agora` : step === 'create' ? t`Proteja seus prontuários`
        : step === 'recover' ? t`Crie uma nova chave pessoal` : t`Desbloqueie seu consultório`}</h1>
      {step === 'loading' ? <p role="status"><Trans>Verificando a proteção da sua conta…</Trans></p>
        : step === 'unavailable' ? <div role="alert"><p><Trans>Não foi possível verificar sua chave. Seus dados continuam protegidos.</Trans></p>
          <button type="button" onClick={() => window.location.reload()}><Trans>Tentar novamente</Trans></button></div>
        : prepared ? <>
          <p><Trans>Esta é a única vez que mostraremos sua chave e seus códigos. Guarde-os em um gerenciador de senhas ou em outro local seguro.</Trans></p>
          {recovery && <p className="vault-warning"><Trans>Ao confirmar, sua chave anterior e todos os códigos anteriores deixarão de abrir este cofre.</Trans></p>}
          <h2><Trans>Chave pessoal</Trans></h2>
          <code className="vault-secret">{prepared.key}</code>
          <h2><Trans>Códigos de recuperação</Trans></h2>
          <p><Trans>Cada código permite criar uma nova chave. Após uma recuperação, guarde os novos códigos; todos os anteriores serão substituídos.</Trans></p>
          <ol className="vault-codes">{prepared.recoveryCodes.map(code => <li key={code}><code>{code}</code></li>)}</ol>
          <div className="vault-actions">
            <button type="button" className="button-secondary" onClick={() => void run(async () => {
              await navigator.clipboard.writeText(kit(prepared))
              if (active.current) setCopied(true)
            }, t`Não foi possível copiar. Você pode baixar o kit ou guardar os códigos manualmente.`)}><Trans>Copiar kit de acesso</Trans></button>
            <button type="button" className="button-secondary" onClick={() => {
              const url = URL.createObjectURL(new Blob([kit(prepared)], { type: 'text/plain;charset=utf-8' }))
              const link = window.document.createElement('a')
              link.href = url
              link.download = 'limmiar-kit-de-acesso.txt'
              link.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            }}><Trans>Baixar kit de acesso</Trans></button>
          </div>
          {copied && <p role="status"><Trans>Kit copiado. Salve-o em um local seguro e limpe a área de transferência.</Trans></p>}
          <form onSubmit={event => {
            event.preventDefault()
            if (!confirmed || confirmation !== prepared.key.slice(-6)) return
            void run(async () => {
              await saveVault(account, prepared.document, recovery)
              if (!active.current) return
              const key = prepared.kek
              setPrepared(null)
              setConfirmation('')
              onUnlocked(key)
            }, t`Não foi possível salvar. Mantenha esta tela aberta e tente novamente. Se outra sessão alterou a chave, entre novamente.`)
          }}>
            <label><Trans>Últimos 6 caracteres da chave pessoal</Trans>
              <input required autoComplete="off" spellCheck={false} maxLength={6} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
            <label className="vault-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required />
              <span><Trans>Guardei a chave e os códigos. Entendo que, sem eles, perderei o acesso aos meus dados.</Trans></span></label>
            <button type="submit" disabled={busy || !confirmed || confirmation !== prepared.key.slice(-6)}><Trans>Concluir e abrir consultório</Trans></button>
          </form>
        </> : step === 'create' ? <>
          <p><Trans>Seu login identifica você. Uma chave pessoal separada protege pacientes, prontuários e notas.</Trans></p>
          <p><Trans>A chave será criada neste dispositivo. O Limmiar não recebe nem guarda uma cópia que possa revelar depois.</Trans></p>
          <p className="vault-warning"><Trans>Se perder a chave e todos os códigos de recuperação, você perderá o acesso aos dados. Nem o suporte poderá recuperá-los.</Trans></p>
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            const result = await createVault(account.accountId)
            if (active.current) setPrepared(result)
          }, t`Não foi possível gerar sua chave. Tente novamente.`)}><Trans>Gerar minha chave pessoal</Trans></button>
        </> : <>
          <p>{step === 'recover' ? t`Use um dos códigos guardados na criação da sua chave. A recuperação preserva seus prontuários e emite uma nova chave e novos códigos.`
            : t`Você já entrou na conta. Digite sua chave pessoal para acessar pacientes e prontuários neste dispositivo.`}</p>
          <form onSubmit={event => void submit(event)}>
            <label>{step === 'recover' ? t`Código de recuperação` : t`Chave pessoal`}
              <input type="password" required maxLength={128} autoComplete="off" autoCapitalize="none" spellCheck={false} value={secret} disabled={busy}
                onChange={event => setSecret(event.target.value)} /></label>
            <button type="submit" disabled={busy || !secret.trim()}>{busy ? t`Verificando…` : step === 'recover' ? t`Gerar nova chave` : t`Desbloquear prontuários`}</button>
          </form>
          <button type="button" className="vault-link" disabled={busy} onClick={() => {
            setStep(step === 'recover' ? 'unlock' : 'recover'); setSecret(''); setError('')
          }}>{step === 'recover' ? t`Voltar ao desbloqueio` : t`Perdi minha chave pessoal`}</button>
          {step === 'recover' && <p className="vault-warning"><Trans>Sem a chave e sem um código de recuperação, os dados não podem ser recuperados.</Trans></p>}
        </>}
      {error && <p role="alert" className="vault-warning">{error}</p>}
      <button type="button" className="vault-link" disabled={busy} onClick={onExit}><Trans>Sair da conta</Trans></button>
    </section>
    <p className="vault-footnote"><Trans>Seus dados são decifrados neste dispositivo enquanto o consultório estiver desbloqueado.</Trans></p>
  </main>
}
