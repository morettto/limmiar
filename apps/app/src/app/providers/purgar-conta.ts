import { clearApiKey } from '../../features/copilot-byok/key-store'
import { purgarIndiceBusca } from '../../features/nota-biblioteca/indice-store'

type PurgaDeConta = (accountId: string) => void | Promise<void>
type EntradaDePurga = readonly [nome: string, purga: PurgaDeConta]

// Módulo-level, NÃO exportada. Exportar a lista, ou um registarPurga(), seria registo
// dinâmico -- a spec recusa isso. Nome literal (não `purga.name`): o bundle de produção
// minifica funções, e `name` deixaria de ser legível no rasto do catch abaixo.
const PURGAS: readonly EntradaDePurga[] = [
  ['clearApiKey', clearApiKey],
  ['purgarIndiceBusca', purgarIndiceBusca],
]

export async function purgarConta(accountId: string): Promise<void> {
  for (const [nome, purga] of PURGAS) {
    try {
      await purga(accountId)
    } catch (erro) {
      // uma purga falhada não trava as outras nem o logout; rasto é tudo o que existe hoje
      // (README `app/providers`). `erro` é seguro no console: DOMException de OPFS/
      // localStorage negado não carrega blob nem material de chave.
      console.error(`SessionProvider: purga "${nome}" falhou para a conta ${accountId}`, erro)
    }
  }
}
