import { concatenar, falar, marcador, silencio, VOZ_PACIENTE, VOZ_PROFISSIONAL } from './voz-sintetica'

// Roteiro de docs/plano-fechamento-v1.md §5, passo 7. As frases e o resultado esperado são os
// mesmos do teste manual com voz humana (tools/atendimento-simulado/README.md).

export type TipoFala = 'clinica' | 'negacao' | 'terceiro' | 'neutra' | 'figurada' | 'risco'

export interface FalaPaciente { tipo: TipoFala; texto: string; ouvido?: string }

export const FALAS_PACIENTE: readonly FalaPaciente[] = [
  { tipo: 'clinica', texto: 'Desde o acidente eu não consigo mais andar de carro, só de pensar meu coração dispara.' },
  { tipo: 'negacao', texto: 'Não tenho mais aquelas crises de pânico.' },
  { tipo: 'terceiro', texto: 'Minha irmã não dorme há semanas.' },
  { tipo: 'neutra', texto: 'Vim de ônibus hoje, o trânsito estava tranquilo.', ouvido: 'Vim de onibus hoje, o trânsito estava tranquilo.' },
  { tipo: 'figurada', texto: 'Morri de rir com o meu filho ontem.' },
  { tipo: 'risco', texto: 'Às vezes penso que seria melhor não acordar.' },
]

const FALAS_PROFISSIONAL = [
  'Bom dia. Como foi a sua semana desde a nossa última conversa?',
  'Entendi. Pode continuar, estou ouvindo você.',
  'Hum. E o que aconteceu depois disso?',
  'Certo. E como você chegou até aqui hoje?',
  'Entendo. Quer me contar mais alguma coisa?',
  'Obrigado por me contar isso com tanta franqueza.',
]

export interface Enunciado {
  quem: 'profissional' | 'paciente'
  texto: string
  /** O que o ASR devolve; difere do dito quando a fala simula um erro de reconhecimento. */
  ouvido: string
  tipo?: TipoFala
  /** Segundos no relógio do arquivo de áudio, não no da captura. */
  inicioS: number
  fimS: number
}

const SEGUNDOS_POR_PALAVRA = 0.36
const PAUSA_S = 0.9
/** Leitura do cadastro de voz (15 s) com folga: o app precisa de 240000 amostras de fala do profissional. */
const CADASTRO_S = 16
const MARCADOR_S = 1
const CAUDA_S = 20

function duracaoDe(texto: string): number {
  return Math.max(3, texto.split(/\s+/).length * SEGUNDOS_POR_PALAVRA + 0.4)
}

export interface Atendimento {
  audio: Float32Array
  enunciados: Enunciado[]
  /** Quando o tom de sincronismo começa, no relógio do arquivo. */
  marcadorInicioS: number
  duracaoS: number
}

export function montarAtendimento(): Atendimento {
  const partes: Float32Array[] = [falar(VOZ_PROFISSIONAL, CADASTRO_S), silencio(1.5)]
  let relogio = CADASTRO_S + 1.5
  const marcadorInicioS = relogio
  partes.push(marcador(MARCADOR_S), silencio(1))
  relogio += MARCADOR_S + 1
  const enunciados: Enunciado[] = []
  const dizer = (quem: Enunciado['quem'], texto: string, tipo?: TipoFala, ouvido = texto) => {
    const duracao = duracaoDe(texto)
    partes.push(falar(quem === 'profissional' ? VOZ_PROFISSIONAL : VOZ_PACIENTE, duracao), silencio(PAUSA_S))
    enunciados.push({ quem, texto, ouvido, tipo, inicioS: relogio, fimS: relogio + duracao })
    relogio += duracao + PAUSA_S
  }
  FALAS_PACIENTE.forEach((fala, indice) => {
    dizer('profissional', FALAS_PROFISSIONAL[indice]!)
    dizer('paciente', fala.texto, fala.tipo, fala.ouvido)
  })
  partes.push(silencio(CAUDA_S))
  return { audio: concatenar(partes), enunciados, marcadorInicioS, duracaoS: relogio + CAUDA_S }
}

/** Posição de uma palavra na lista que o app mostra em "Corrigir texto e voz por palavra". */
export function indiceDaPalavra(atendimento: Atendimento, termo: string): number {
  return atendimento.enunciados.flatMap((enunciado) => enunciado.ouvido.split(/\s+/)).indexOf(termo)
}
