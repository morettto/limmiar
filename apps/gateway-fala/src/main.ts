import { lerConfig } from './config.ts'
import { criarExtratorTitanet } from './extrator.ts'
import { criarPoolUpstream } from './pool.ts'
import { criarServidor } from './servidor.ts'
import { criarTrabalhadorTitanet } from './trabalhador-titanet.ts'
import { criarAbridorUpstream } from './upstream.ts'

const config = lerConfig(process.env)
// Só categorias e contagens vão ao log: nunca fala, impressão de voz ou texto.
const registrar = (evento: string) => console.info(JSON.stringify({ em: new Date().toISOString(), evento }))

const extrator = await criarExtratorTitanet({ modelo: config.modelo, threads: config.threads, aoQuebrar: (erro) => {
  console.error(`O extrator de voz quebrou: ${erro.message}`)
  process.exit(1)
} }, criarTrabalhadorTitanet)
const servidor = criarServidor({
  chave: config.chave,
  pingMs: 20_000,
  extrator,
  registrar,
  abrirUpstream: criarPoolUpstream(config.nemotronUrls.map((url) =>
    criarAbridorUpstream({ url, chave: config.nemotronChave, endpointingMs: 600, aberturaMs: 10_000 })), config.sessoesPorInstancia),
})
servidor.http.listen(config.porta, config.host, () => registrar(`gateway de fala em ${config.host}:${config.porta}`))

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => { void servidor.fechar().then(() => extrator.encerrar()).then(() => process.exit(0)) })
}
