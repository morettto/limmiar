export interface Config {
  host: string
  porta: number
  chave: string | undefined
  modelo: string
  modeloSegmentacao: string
  threads: number
  nemotronUrls: string[]
  sessoesPorInstancia: number
  nemotronChave: string | undefined
}

const inteiro = (valor: string | undefined, padrao: number, nome: string): number => {
  if (valor === undefined || valor === '') return padrao
  const numero = Number(valor)
  if (!Number.isInteger(numero) || numero < 1) throw new Error(`${nome} precisa ser um inteiro positivo.`)
  return numero
}

// Chaves de API só por variável de ambiente: nunca em argumento (aparece em `ps`) nem em arquivo da imagem.
export function lerConfig(env: Record<string, string | undefined>): Config {
  const modelo = env.GATEWAY_FALA_MODELO
  if (!modelo) throw new Error('GATEWAY_FALA_MODELO precisa apontar para o titanet.onnx.')
  const modeloSegmentacao = env.GATEWAY_FALA_SEGMENTACAO
  if (!modeloSegmentacao) throw new Error('GATEWAY_FALA_SEGMENTACAO precisa apontar para o modelo de segmentação.')
  return {
    host: env.GATEWAY_FALA_HOST || '127.0.0.1',
    porta: inteiro(env.GATEWAY_FALA_PORTA, 8090, 'GATEWAY_FALA_PORTA'),
    chave: env.GATEWAY_FALA_CHAVE || undefined,
    modelo,
    modeloSegmentacao,
    threads: inteiro(env.GATEWAY_FALA_THREADS, 2, 'GATEWAY_FALA_THREADS'),
    // Vários processos do NeMo-Speech, separados por vírgula (ver pool.ts).
    nemotronUrls: (env.NEMOTRON_URLS || 'ws://127.0.0.1:8080/v1/audio/transcriptions/realtime').split(',').map((url) => url.trim()).filter(Boolean),
    sessoesPorInstancia: inteiro(env.NEMOTRON_SESSOES_POR_INSTANCIA, 2, 'NEMOTRON_SESSOES_POR_INSTANCIA'),
    nemotronChave: env.NEMOTRON_CHAVE || undefined,
  }
}
