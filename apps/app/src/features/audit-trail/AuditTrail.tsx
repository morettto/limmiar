import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { request } from '../../shared/api'

type Acao = 'signIn' | 'signOut' | 'recordOpened' | 'recordAppended' | 'noteSigned' | 'exportRequested'
interface Entrada { sequence: number; action: Acao; deviceId: string; recordedAt: string }
interface Trilha { intact: boolean; firstBrokenSequence: number | null; entries: Entrada[] }

export interface AuditTrailProps { baseUrl: string; accountId: string; accessToken: string }

// eslint-disable-next-line lingui/no-unlocalized-strings -- query parameter names and ISO time suffix, not visible copy.
const [DESDE, ATE, MEIA_NOITE, CSV, CURTA, MEDIA] = ['from', 'to', 'T00:00:00', 'text/csv', 'short', 'medium'] as const

function caminho(accountId: string, de: string, ate: string, exportar: boolean) {
  const busca = new URLSearchParams()
  if (de) busca.set(DESDE, new Date(de + MEIA_NOITE).toISOString())
  if (ate) busca.set(ATE, new Date(ate + MEIA_NOITE).toISOString())
  const consulta = busca.size ? `?${busca}` : ''
  return `/accounts/${accountId}/audit${exportar ? '/exports' : ''}${consulta}`
}

export function AuditTrail({ baseUrl, accountId, accessToken }: AuditTrailProps) {
  const { t, i18n } = useLingui()
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [trilha, setTrilha] = useState<Trilha | null>(null)
  const [erro, setErro] = useState(false)
  const nomes: Record<Acao, string> = {
    signIn: t`Entrada na conta`, signOut: t`Saída da conta`, recordOpened: t`Prontuário aberto`,
    recordAppended: t`Registro acrescentado ao prontuário`, noteSigned: t`Nota assinada`, exportRequested: t`Trilha exportada`,
  }

  useEffect(() => {
    let ativo = true
    void request(baseUrl, 'GET', caminho(accountId, de, ate, false), undefined, accessToken).then(async (resposta) => {
      if (!ativo) return
      if (!resposta.ok) { setErro(true); return }
      const corpo = await resposta.response.json() as Trilha
      if (ativo) { setErro(false); setTrilha(corpo) }
    })
    return () => { ativo = false }
  }, [baseUrl, accountId, accessToken, de, ate])

  const quebra = trilha?.firstBrokenSequence

  async function exportar() {
    const resposta = await request(baseUrl, 'POST', caminho(accountId, de, ate, true), undefined, accessToken)
    if (!resposta.ok) { setErro(true); return }
    const corpo = await resposta.response.json() as Trilha
    setTrilha(corpo)
    // eslint-disable-next-line lingui/no-unlocalized-strings -- CSV header is a machine format, not visible copy.
    const linhas = ['sequencia,acao,dispositivo,instante', ...corpo.entries.map((e) => `${e.sequence},${e.action},${e.deviceId},${e.recordedAt}`)]
    const url = URL.createObjectURL(new Blob([linhas.join('\n')], { type: CSV }))
    // eslint-disable-next-line lingui/no-unlocalized-strings -- HTML tag name, not visible copy.
    const link = document.createElement('a')
    link.href = url
    // eslint-disable-next-line lingui/no-unlocalized-strings -- file name, not visible copy.
    link.download = 'trilha-auditoria.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return <section aria-label={t`Trilha de auditoria`}>
    <p><Trans>Só metadados: o quê, quando e de que sessão. Nunca conteúdo clínico.</Trans></p>
    <label><Trans>Desde</Trans> <input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
    <label><Trans>Até (exclusive)</Trans> <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
    <button type="button" onClick={() => void exportar()}><Trans>Exportar CSV</Trans></button>
    {erro && <p role="alert"><Trans>Não foi possível ler a trilha de auditoria.</Trans></p>}
    {trilha && <p role="status">{trilha.intact ? t`Cadeia íntegra: nenhuma entrada foi alterada.` : t`Cadeia quebrada a partir da entrada ${quebra}.`}</p>}
    {trilha && <table>
      <thead><tr><th><Trans>Nº</Trans></th><th><Trans>Ação</Trans></th><th><Trans>Sessão</Trans></th><th><Trans>Instante</Trans></th></tr></thead>
      <tbody>{trilha.entries.map((e) => <tr key={e.sequence}>
        <td>{e.sequence}</td><td>{nomes[e.action]}</td><td>{e.deviceId.slice(0, 8)}</td>
        <td>{i18n.date(e.recordedAt, { dateStyle: CURTA, timeStyle: MEDIA })}</td>
      </tr>)}</tbody>
    </table>}
  </section>
}
