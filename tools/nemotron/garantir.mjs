// Garante os processos do serviço de transcrição: N containers do NeMo-Speech, cada um fixo nos seus núcleos (veja o README).
// Idempotente: cria o que falta, reinicia o parado, recria o de configuração antiga e espera o /ready de todos.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Versão fixa: o gateway fala o protocolo da 0.2.0 (tools/nemotron/README.md). A receita da imagem é o Dockerfile ao lado.
// CPU (padrão): processos pequenos fixos em núcleos, porque um processo serializa as sessões e o ggml disputa os núcleos.
// GPU (NEMOTRON_DISPOSITIVO=cuda): um processo só; as vagas na GPU são o state_arena_slots.
const GPU = process.env.NEMOTRON_DISPOSITIVO === 'cuda'
export const IMAGEM = GPU ? 'limmiar-nemotron:0.2.0-cuda' : 'limmiar-nemotron:0.2.0-cpu'
export const INSTANCIAS = GPU ? 1 : Number(process.env.NEMOTRON_INSTANCIAS || 2)
export const NUCLEOS_POR_INSTANCIA = Number(process.env.NEMOTRON_NUCLEOS_POR_INSTANCIA || 2)
export const SESSOES_POR_INSTANCIA = GPU ? Number(process.env.NEMOTRON_SESSOES_GPU || 8) : 2
const PORTA_INICIAL = 8081
// Os porquês de cada flag estão em tools/nemotron/README.md. --threads é o pool HTTP: cada sessão ocupa um worker.
export const COMANDO = ['serve', '--host', '0.0.0.0', '--asr-model', 'nemotron-3.5', '--device', GPU ? 'cuda' : 'cpu', '--endpointing',
  '--stop-history-eou-ms', '600', '--threads', String(SESSOES_POR_INSTANCIA + 2), '--no-ui',
  ...(GPU ? ['--asr.batching.state_arena_slots', String(SESSOES_POR_INSTANCIA)] : [])]
// A primeira subida baixa ~710 MB de modelo para o volume nemotron_models.
const ESPERA_MAXIMA_S = 600

export const instancias = Array.from({ length: INSTANCIAS }, (_, indice) => ({
  container: `nemotron-speech-${indice + 1}`,
  porta: PORTA_INICIAL + indice,
  nucleos: GPU ? '' : `${indice * NUCLEOS_POR_INSTANCIA}-${indice * NUCLEOS_POR_INSTANCIA + NUCLEOS_POR_INSTANCIA - 1}`,
}))
export const URLS_REALTIME = instancias.map(({ porta }) => `ws://127.0.0.1:${porta}/v1/audio/transcriptions/realtime`)

const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const pausa = (ms) => new Promise((resolver) => setTimeout(resolver, ms))

async function pronto(porta) {
  try { return (await (await fetch(`http://127.0.0.1:${porta}/ready`)).json()).ready === true } catch { return false }
}

function garantirContainer({ container, porta, nucleos }) {
  let estado
  try {
    estado = docker(['inspect', container, '--format', '{{.State.Status}}'])
    const atual = docker(['inspect', container, '--format', '{{.Config.Image}}|{{json .Config.Cmd}}|{{.HostConfig.CpusetCpus}}'])
    if (atual !== `${IMAGEM}|${JSON.stringify(COMANDO)}|${nucleos}`) { docker(['rm', '-f', container]); estado = undefined }
  } catch { /* Container ainda não criado. */ }
  if (!estado) {
    docker(['run', '-d', '--name', container, '--restart', 'unless-stopped', ...(GPU ? ['--gpus', 'all'] : ['--cpuset-cpus', nucleos]),
      '-p', `127.0.0.1:${porta}:8080`, '-v', 'nemotron_models:/models', IMAGEM, ...COMANDO])
    console.log(`Container ${container} criado (${GPU ? 'GPU' : `núcleos ${nucleos}`}, porta ${porta}).`)
  } else if (estado !== 'running') {
    docker(['start', container])
    console.log(`Container ${container} iniciado.`)
  }
}

function garantirImagem() {
  try { docker(['image', 'inspect', IMAGEM]) } catch {
    console.log(`Construindo a imagem ${IMAGEM} (tools/nemotron/Dockerfile).`)
    execFileSync('docker', ['build', ...(GPU ? ['--build-arg', 'BACKEND=cuda'] : []), '-t', IMAGEM, fileURLToPath(new URL('.', import.meta.url))], { stdio: 'inherit' })
  }
}

export async function garantirServicoDeTranscricao() {
  garantirImagem()
  // Containers de quantidades anteriores (ex.: NEMOTRON_INSTANCIAS menor agora) saem para não ocupar núcleos à toa.
  const nomes = new Set(instancias.map(({ container }) => container))
  for (const nome of docker(['ps', '-a', '--format', '{{.Names}}']).split('\n')) {
    if (/^nemotron-speech-\d+$/.test(nome) && !nomes.has(nome)) docker(['rm', '-f', nome])
  }
  instancias.forEach(garantirContainer)
  for (const { container, porta } of instancias) {
    for (let segundos = 0; !(await pronto(porta)); segundos += 2) {
      if (segundos >= ESPERA_MAXIMA_S) throw new Error(`O serviço não ficou pronto em ${ESPERA_MAXIMA_S} s; confira docker logs ${container}.`)
      if (docker(['inspect', container, '--format', '{{.State.Status}}']) !== 'running') throw new Error(`O container ${container} parou; confira docker logs ${container}.`)
      if (segundos === 10) console.log('Esperando o serviço de transcrição carregar os modelos (a primeira vez baixa ~810 MB)...')
      await pausa(2000)
    }
  }
  console.log(`Serviço de transcrição pronto: ${INSTANCIAS} processos, até ${INSTANCIAS * SESSOES_POR_INSTANCIA} sessões simultâneas.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await garantirServicoDeTranscricao() }
  catch (erro) {
    console.error('Não foi possível preparar o serviço de transcrição. Abra o Docker Desktop e leia tools/nemotron/README.md.')
    console.error(erro.stderr?.toString() || erro.message)
    process.exit(1)
  }
}
