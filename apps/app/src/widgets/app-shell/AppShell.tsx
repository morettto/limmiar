import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Trans, useLingui } from '@lingui/react/macro'
import { useSession } from '../../entities/account/session-context'
import { LanguageSwitcher } from '../../features/language-switcher/LanguageSwitcher'
import { BloqueioContext } from './bloqueio'
import './app-shell.css'

export function AppShell({ children }: { children: ReactNode }) {
  const { sessao, kek } = useSession()
  const [bloqueios, setBloqueios] = useState(0)
  const comBarra = sessao?.role === 'Professional' && sessao.accessToken !== null && kek !== null
  // Um único seletor por tela: na barra para o profissional; fora dela, depois do conteúdo no DOM
  // (o 1.º Tab de um ecrã de paciente é o CVV, ADR-S11-04) e o CSS o leva ao topo.
  return <BloqueioContext.Provider value={setBloqueios}>
    {comBarra && <BarraDoConsultorio email={sessao.email} bloqueada={bloqueios > 0} />}
    {children}
    {!comBarra && <LanguageSwitcher />}
  </BloqueioContext.Provider>
}

function BarraDoConsultorio({ email, bloqueada }: { email: string | null; bloqueada: boolean }) {
  const { t } = useLingui()
  const { terminarSessao } = useSession()
  const [menuAberto, setMenuAberto] = useState(false)
  const [contaAberta, setContaAberta] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)
  const contaRef = useRef<HTMLButtonElement>(null)
  const contaNavRef = useRef<HTMLElement>(null)
  const painelId = useId()
  const configuracoesId = useId()

  useEffect(() => {
    if (!contaAberta) return
    const aoSair = new AbortController()
    document.addEventListener('pointerdown', evento => {
      if (!contaNavRef.current!.contains(evento.target as Node)) setContaAberta(false)
    }, { signal: aoSair.signal })
    return () => aoSair.abort()
  }, [contaAberta])

  function fechar() { setMenuAberto(false); setContaAberta(false) }
  function aoTeclar(evento: KeyboardEvent) {
    if (evento.key !== 'Escape') return
    if (contaAberta) { setContaAberta(false); contaRef.current!.focus() }
    else if (menuAberto) { setMenuAberto(false); menuRef.current!.focus() }
  }
  const link = { className: 'app-bar-link', disabled: bloqueada, onClick: fechar }

  return <header className="app-bar" onKeyDown={aoTeclar}>
    <Link to="/" className="app-bar-brand" disabled={bloqueada} onClick={fechar}>Limmiar</Link>
    <button ref={menuRef} type="button" className="app-bar-toggle" aria-expanded={menuAberto} aria-controls={painelId}
      onClick={() => setMenuAberto(aberto => !aberto)}><Trans>Menu</Trans><span className="app-bar-chevron" aria-hidden="true" /></button>
    <div id={painelId} className="app-bar-panel" data-aberto={menuAberto || undefined}>
      <nav className="app-bar-nav" aria-label={t`Navegação principal`}>
        <ul>
          <li><Link to="/" {...link}><Trans>Consultório</Trans></Link></li>
          <li><Link to="/pacientes" {...link}><Trans>Pacientes</Trans></Link></li>
          <li><Link to="/biblioteca" {...link}><Trans>Biblioteca de notas</Trans></Link></li>
          <li><Link to="/acervo" {...link}><Trans>Acervo pessoal</Trans></Link></li>
          <li><Link to="/espelho" {...link}><Trans>Sinais compartilhados pelos pacientes</Trans></Link></li>
        </ul>
      </nav>
      <nav ref={contaNavRef} className="app-bar-account" aria-label={t`Conta`}>
        <LanguageSwitcher />
        <span className="editorial-meta app-bar-email" data-testid="conta-sessao">{email}</span>
        <button ref={contaRef} type="button" aria-expanded={contaAberta} aria-controls={configuracoesId}
          onClick={() => setContaAberta(aberta => !aberta)}><Trans>Conta</Trans><span className="app-bar-chevron" aria-hidden="true" /></button>
        {contaAberta && <ul id={configuracoesId} className="app-bar-settings">
          <li><Link to="/settings/copilot" {...link}><Trans>Votos do copiloto de IA</Trans></Link></li>
          <li><Link to="/settings/voice" {...link}><Trans>Identificação da sua voz</Trans></Link></li>
          <li><Link to="/settings/audit" {...link}><Trans>Trilha de auditoria</Trans></Link></li>
          <li><Link to="/settings/recovery" {...link}><Trans>Frase de recuperação</Trans></Link></li>
          <li><Link to="/devices/pair-primary" {...link}><Trans>Parear novo dispositivo</Trans></Link></li>
        </ul>}
        <button type="button" disabled={bloqueada} onClick={terminarSessao}><Trans>Sair</Trans></button>
      </nav>
    </div>
    {bloqueada && <p role="status" className="app-bar-aviso"><Trans>Aguarde o processamento da sessão antes de sair.</Trans></p>}
  </header>
}
