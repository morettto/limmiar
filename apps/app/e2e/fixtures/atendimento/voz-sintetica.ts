// Voz por síntese de formantes (fonte de pulsos + ressonadores), sem dependência e sem sorteio
// não semeado: o mesmo roteiro gera sempre os mesmos bytes. Não é fala inteligível; serve para o
// reconhecedor de voz do navegador (TitaNet) ver duas pessoas com timbres distintos.

export const TAXA = 16000

export interface Voz {
  /** Tom médio em Hz. */
  f0: number
  /** Escala dos formantes: maior = trato vocal mais curto. */
  trato: number
  sopro: number
  semente: number
}

export const VOZ_PROFISSIONAL: Voz = { f0: 118, trato: 1, sopro: 0.02, semente: 11 }
export const VOZ_PACIENTE: Voz = { f0: 205, trato: 1.2, sopro: 0.05, semente: 29 }

const VOGAIS: readonly (readonly [number, number, number])[] = [
  [730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240],
]
const LARGURAS = [90, 110, 160, 220] as const
const SILABAS_POR_SEGUNDO = 4.2

function semeado(semente: number): () => number {
  let estado = semente >>> 0
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0
    let valor = Math.imul(estado ^ (estado >>> 15), 1 | estado)
    valor = (valor + Math.imul(valor ^ (valor >>> 7), 61 | valor)) ^ valor
    return ((valor ^ (valor >>> 14)) >>> 0) / 4294967296
  }
}

interface Ressonador { b1: number; b2: number; ganho: number; y1: number; y2: number }

function ajustar(r: Ressonador, frequencia: number, largura: number): void {
  const c = -Math.exp(-2 * Math.PI * largura / TAXA)
  r.b1 = 2 * Math.exp(-Math.PI * largura / TAXA) * Math.cos(2 * Math.PI * frequencia / TAXA)
  r.b2 = c
  r.ganho = 1 - r.b1 - c
}

/** Uma fala contínua de `duracaoS` segundos, com pico em 0,6 e bordas suavizadas. */
export function falar(voz: Voz, duracaoS: number): Float32Array {
  const total = Math.round(duracaoS * TAXA)
  const saida = new Float32Array(total)
  const sorteio = semeado(voz.semente)
  const silabas = Math.max(1, Math.round(duracaoS * SILABAS_POR_SEGUNDO))
  const porSilaba = total / silabas
  // Sequência fixa de vogais e tons: toda fala da mesma voz tem o mesmo desenho, para o embedding variar
  // pouco entre falas e a voz seguir uma só. Só a duração muda.
  const alvos = Array.from({ length: silabas + 1 }, (_, k) => ({
    vogal: VOGAIS[(k * 2 + voz.semente) % VOGAIS.length]!,
    tom: voz.f0 * (1 + 0.04 * Math.sin(k * 1.3)),
  }))
  const filtros: Ressonador[] = LARGURAS.map(() => ({ b1: 0, b2: 0, ganho: 0, y1: 0, y2: 0 }))
  let fase = 0
  let inclinacao = 0
  for (let i = 0; i < total; i++) {
    const posicao = i / porSilaba
    const indice = Math.min(silabas - 1, Math.floor(posicao))
    const parte = posicao - indice
    const de = alvos[indice]!
    const para = alvos[indice + 1]!
    if (i % 16 === 0) {
      const mistura = Math.min(1, parte * 1.6)
      filtros.forEach((filtro, formante) => {
        const origem = de.vogal[formante] ?? 3500
        const destino = para.vogal[formante] ?? 3500
        ajustar(filtro, (origem + (destino - origem) * mistura) * voz.trato, LARGURAS[formante]!)
      })
    }
    const tom = (de.tom + (para.tom - de.tom) * parte) * (1 + 0.015 * Math.sin(2 * Math.PI * 5 * i / TAXA))
    fase += tom / TAXA
    let excitacao = 0
    if (fase >= 1) { fase -= 1; excitacao = 1 }
    excitacao += (sorteio() * 2 - 1) * voz.sopro
    inclinacao = 0.92 * inclinacao + excitacao
    let amostra = inclinacao
    for (const filtro of filtros) {
      const y = filtro.ganho * amostra + filtro.b1 * filtro.y1 + filtro.b2 * filtro.y2
      filtro.y2 = filtro.y1
      filtro.y1 = y
      amostra = y
    }
    const envoltoria = Math.sin(Math.PI * Math.min(1, parte * 1.15 + 0.08)) ** 0.5
    saida[i] = amostra * envoltoria
  }
  let pico = 0
  for (const valor of saida) pico = Math.max(pico, Math.abs(valor))
  const borda = Math.round(0.06 * TAXA)
  for (let i = 0; i < total; i++) {
    const rampa = Math.min(1, i / borda, (total - 1 - i) / borda)
    saida[i] = saida[i]! / pico * 0.6 * rampa
  }
  return saida
}

/** Ruído de sala quase inaudível: o canal nunca é zero absoluto, como num microfone real. */
export function silencio(duracaoS: number, semente = 5): Float32Array {
  const sorteio = semeado(semente)
  return Float32Array.from({ length: Math.round(duracaoS * TAXA) }, () => (sorteio() * 2 - 1) * 0.0005)
}

const FREQUENCIA_MARCADOR = 1000

/** Tom puro que o fake do Worker do ASR usa para saber em que ponto do arquivo a captura está. */
export function marcador(duracaoS: number): Float32Array {
  const total = Math.round(duracaoS * TAXA)
  const borda = Math.round(0.02 * TAXA)
  return Float32Array.from({ length: total }, (_, i) =>
    0.5 * Math.sin(2 * Math.PI * FREQUENCIA_MARCADOR * i / TAXA) * Math.min(1, i / borda, (total - 1 - i) / borda))
}

export function concatenar(partes: readonly Float32Array[]): Float32Array {
  const saida = new Float32Array(partes.reduce((soma, parte) => soma + parte.length, 0))
  let inicio = 0
  for (const parte of partes) { saida.set(parte, inicio); inicio += parte.length }
  return saida
}
