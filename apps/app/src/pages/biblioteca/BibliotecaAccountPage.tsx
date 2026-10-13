import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { carregarBiblioteca } from '../../features/nota-biblioteca/carregar-biblioteca'
import { chaveIndiceDaConta } from '../../features/nota-biblioteca/indice-crypto'
import { opfsIndice } from '../../features/nota-biblioteca/indice-store'
import { BibliotecaPage, type BibliotecaPageProps } from './BibliotecaPage'

interface Props { baseUrl: string; accountId: string; accessToken: string; kek: CryptoKey }

export function BibliotecaAccountPage({ baseUrl, accountId, accessToken, kek }: Props) {
  const { t } = useLingui()
  const [dados, setDados] = useState<(BibliotecaPageProps & { conta: string; chave: CryptoKey }) | null>(null)
  const [erro, setErro] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  useEffect(() => {
    let cancelada = false
    setDados(null)
    setErro(false)
    async function carregar() {
      const biblioteca = await carregarBiblioteca(baseUrl, accountId, accessToken, kek)
      if (cancelada) return
      const raiz = await navigator.storage.getDirectory()
      const dir = await raiz.getDirectoryHandle(accountId, { create: true })
      if (cancelada) return
      setDados({ ...biblioteca, chaveIndice: chaveIndiceDaConta(kek), store: opfsIndice(dir), conta: accountId, chave: kek })
    }
    void carregar().catch(() => { if (!cancelada) setErro(true) })
    return () => { cancelada = true }
  }, [baseUrl, accountId, accessToken, kek, tentativa])
  // Stryker disable next-line ArithmeticOperator: equivalent, a retry counter only has to differ from the previous value.
  const tentarNovamente = () => setTentativa((valor) => valor + 1)
  if (dados?.conta === accountId && dados.chave === kek) return <BibliotecaPage {...dados} />
  return <main className="workspace">
    <header><h1><Trans>Biblioteca de notas</Trans></h1></header>
    {erro ? <section className="workspace-card"><p role="alert">{t`Não foi possível carregar a biblioteca. Tente novamente.`}</p>
      <button type="button" onClick={tentarNovamente}><Trans>Tentar novamente</Trans></button>
    </section> : <p role="status"><Trans>Carregando notas do prontuário...</Trans></p>}
  </main>
}
