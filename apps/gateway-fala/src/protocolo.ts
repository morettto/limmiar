export const TAXA_AMOSTRAGEM = 16000
export const AMOSTRAS_POR_MS = TAXA_AMOSTRAGEM / 1000

export type Falante = string
export type FalanteDaTrilha = 'profissional' | 'paciente'

export interface Palavra {
  texto: string
  inicio_ms: number
  fim_ms: number
}

// O que o gateway manda ao navegador: só o que é novo. `parcial` substitui o anterior (texto da frase em curso, ainda sem tempos); `final` chega uma vez por frase,
// com o falante já resolvido; `falante` corrige uma frase curta que herdou o rótulo da vizinha.
export type Saida =
  | { type: 'pronta' }
  | { type: 'parcial'; texto: string; processado_ms: number }
  | { type: 'final'; frase: number; falante: Falante | null; palavras: Palavra[]; processado_ms: number }
  | { type: 'falante'; frase: number; falante: Falante }
  | { type: 'concluida' }
  | { type: 'erro'; mensagem: string }

export type Inicio =
  | { modo: 'presencial'; idioma: string; perfil: number[] }
  | { modo: 'online'; idioma: string; falante: FalanteDaTrilha }

export class ErroDeProtocolo extends Error {}

const IDIOMA = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/

// A impressão de voz entra só aqui, na mensagem inicial, e nunca é registrada: nenhuma mensagem de erro cita seu conteúdo.
export function lerInicio(texto: string, dimensao: number): Inicio {
  let mensagem: Record<string, unknown>
  try { mensagem = JSON.parse(texto) as Record<string, unknown> } catch { throw new ErroDeProtocolo('A mensagem inicial não é JSON.') }
  if (typeof mensagem !== 'object' || mensagem === null || mensagem.type !== 'iniciar') throw new ErroDeProtocolo('Esperava a mensagem "iniciar".')
  if (mensagem.sample_rate !== TAXA_AMOSTRAGEM) throw new ErroDeProtocolo('Só há suporte a 16 kHz.')
  const idioma = mensagem.idioma
  if (typeof idioma !== 'string' || !IDIOMA.test(idioma)) throw new ErroDeProtocolo('Idioma inválido.')
  if (mensagem.modo === 'online') {
    if (mensagem.falante !== 'profissional' && mensagem.falante !== 'paciente') throw new ErroDeProtocolo('Sessão online precisa do falante da trilha.')
    return { modo: 'online', idioma, falante: mensagem.falante }
  }
  const perfil = mensagem.perfil
  if (mensagem.modo !== 'presencial') throw new ErroDeProtocolo('Modo inválido.')
  if (!Array.isArray(perfil) || perfil.length !== dimensao || !perfil.every((valor) => typeof valor === 'number' && Number.isFinite(valor)) ||
    !perfil.some((valor: number) => valor !== 0)) throw new ErroDeProtocolo('Perfil de voz inválido.')
  return { modo: 'presencial', idioma, perfil: perfil as number[] }
}

export function ehConcluir(texto: string): boolean {
  try { return (JSON.parse(texto) as { type?: unknown } | null)?.type === 'concluir' } catch { return false }
}
