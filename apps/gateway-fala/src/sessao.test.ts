import { describe, expect, it, vi } from 'vitest'
import type { Inicio, Saida } from './protocolo.ts'
import { PARAMETROS_PADRAO, Sessao, type Dependencias, type ParametrosSessao } from './sessao.ts'
import { adiado, AbridorFalso, AMPLITUDE, CanalFalso, esperar, ExtratorFalso, INICIO_PRESENCIAL, PARAMETROS, pcmConstante } from './test-support/falsos.ts'

const SEM_ROTACAO: ParametrosSessao = { ...PARAMETROS, rotacaoMs: 1e9, rotacaoForcadaMs: 1e9 }

async function iniciar(inicio: Inicio = INICIO_PRESENCIAL, extra: Partial<Dependencias> = {}) {
  const canal = new CanalFalso()
  const abridor = new AbridorFalso()
  const extrator = new ExtratorFalso()
  const registrar = vi.fn()
  const sessao = new Sessao(inicio, canal, { abrirUpstream: abridor.abrir, extrator, parametros: SEM_ROTACAO, registrar, ...extra })
  await sessao.abrir()
  return { sessao, canal, abridor, extrator, registrar, up: abridor.abertos[0]! }
}

// 2 s da voz A (o profissional) seguidos de 2 s da voz B.
function falaAB(sessao: Sessao) {
  sessao.pcm(pcmConstante(2000, AMPLITUDE.A))
  sessao.pcm(pcmConstante(2000, AMPLITUDE.B))
}

describe('abertura e áudio', () => {
  it('abre a sessão upstream no idioma pedido e só então avisa que está pronta', async () => {
    const { canal, up } = await iniciar({ ...INICIO_PRESENCIAL, idioma: 'pt-BR' })
    expect(up.idioma).toBe('pt-BR')
    expect(canal.saidas).toEqual([{ type: 'pronta' }])
  })

  it('repassa o PCM ao upstream', async () => {
    const { sessao, up } = await iniciar()
    sessao.pcm(pcmConstante(80, 5))
    sessao.pcm(pcmConstante(80, 5))
    expect(up.enviados).toHaveLength(2)
    expect(up.amostras).toBe(2 * 80 * 16)
  })

  it('se foi encerrada enquanto abria, fecha o upstream e não avisa pronta', async () => {
    const canal = new CanalFalso()
    const abridor = new AbridorFalso()
    const sessao = new Sessao(INICIO_PRESENCIAL, canal, { abrirUpstream: abridor.abrir, extrator: new ExtratorFalso() })
    const abrindo = sessao.abrir()
    sessao.encerrar()
    await abrindo
    expect(abridor.abertos[0]!.fechado).toBe(true)
    expect(canal.saidas).toEqual([])
  })

  it('propaga a falha de abertura ao chamador', async () => {
    const abridor = new AbridorFalso()
    abridor.falhaNaProxima = new Error('sem upstream')
    const sessao = new Sessao(INICIO_PRESENCIAL, new CanalFalso(), { abrirUpstream: abridor.abrir, extrator: new ExtratorFalso() })
    await expect(sessao.abrir()).rejects.toThrow('sem upstream')
  })
})

describe('quem fala, no modo presencial', () => {
  it('verifica cada frase com o áudio dela e manda só as palavras novas, com tempo e falante', async () => {
    const { sessao, canal, extrator, up } = await iniciar()
    falaAB(sessao)
    up.palavras([['Bom', 0.1, 0.5], ['dia', 0.6, 1.5]], 2, 1.6)
    await esperar()
    up.palavras([['Bom', 0.1, 0.5], ['dia', 0.6, 1.5], ['Dor', 2.2, 3], ['forte', 3.1, 3.8]], 4, 3.9)
    await esperar()
    expect(canal.de('final')).toEqual([
      { type: 'final', ordem: 0, frase: 0, falante: 'profissional', processado_ms: 1600,
        palavras: [{ texto: 'Bom', inicio_ms: 100, fim_ms: 500 }, { texto: 'dia', inicio_ms: 600, fim_ms: 1500 }] },
      { type: 'final', ordem: 3, frase: 1, falante: 'paciente', processado_ms: 3900,
        palavras: [{ texto: 'Dor', inicio_ms: 2200, fim_ms: 3000 }, { texto: 'forte', inicio_ms: 3100, fim_ms: 3800 }] },
    ])
    expect(extrator.chamadas.every(tamanho => tamanho === 8000)).toBe(true)
  })

  it('agrupa as vozes que não são o profissional e numera as novas', async () => {
    const { sessao, canal, up } = await iniciar()
    sessao.pcm(pcmConstante(1000, AMPLITUDE.A))
    sessao.pcm(pcmConstante(1000, AMPLITUDE.B))
    sessao.pcm(pcmConstante(1000, AMPLITUDE.C))
    sessao.pcm(pcmConstante(1000, AMPLITUDE.B))
    const todas: [string, number, number][] = [['profissional', 0.1, 0.8], ['um', 1.1, 1.8], ['dois', 2.1, 2.8], ['tres', 3.1, 3.8]]
    for (let finais = 1; finais <= 4; finais++) {
      up.palavras(todas.slice(0, finais), finais)
      await esperar()
    }
    expect(canal.de('final').map((final) => final.falante)).toEqual(['profissional', 'paciente', 'pessoa_2', 'paciente'])
  })

  it('frase curta herda o falante da anterior e é corrigida quando a vizinha seguinte está mais perto', async () => {
    const { sessao, canal, extrator, up } = await iniciar()
    falaAB(sessao)
    up.palavras([['Olá', 0.1, 1.5]], 1)
    await esperar()
    up.palavras([['Olá', 0.1, 1.5], ['Sim', 2.1, 2.3]], 2)
    await esperar()
    expect(canal.de('final')[1]).toMatchObject({ frase: 1, falante: null })
    expect(extrator.chamadas).toHaveLength(5)
    up.palavras([['Olá', 0.1, 1.5], ['Sim', 2.1, 2.3], ['Estou', 2.4, 2.8], ['mal', 2.9, 3.9]], 4)
    await esperar()
    expect(canal.de('final')[2]).toMatchObject({ frase: 2, falante: 'paciente' })
    expect(canal.de('falante')).toEqual([{ type: 'falante', frase: 1, falante: 'paciente' }])
  })

  it('frase curta sem nenhuma vizinha fica sem falante até a próxima ser verificada', async () => {
    const { sessao, canal, up } = await iniciar()
    falaAB(sessao)
    up.palavras([['Oi', 0.1, 0.2]], 1)
    await esperar()
    up.palavras([['Oi', 0.1, 0.2], ['Bom', 0.5, 0.9], ['dia', 1, 1.6]], 3)
    await esperar()
    expect(canal.de('final').map((final) => final.falante)).toEqual([null, 'profissional'])
    expect(canal.de('falante')).toEqual([{ type: 'falante', frase: 0, falante: 'profissional' }])
  })

  it('trata como curta a frase cujo embedding não saiu válido', async () => {
    const { sessao, canal, extrator, up } = await iniciar()
    falaAB(sessao)
    extrator.retorno = () => Promise.resolve(null)
    up.palavras([['Bom', 0.1, 1.5]], 1)
    await esperar()
    expect(extrator.chamadas).toHaveLength(2)
    expect(canal.de('final')[0]!.falante).toBeNull()
  })

  it('trata como curta a frase cujo áudio já saiu da memória', async () => {
    const { sessao, canal, extrator, up } = await iniciar(INICIO_PRESENCIAL, { parametros: { ...SEM_ROTACAO, bufferMs: 1000 } })
    sessao.pcm(pcmConstante(3000, AMPLITUDE.A))
    up.palavras([['Bom', 0.1, 1.5]], 1)
    await esperar()
    expect(extrator.chamadas).toEqual([])
    expect(canal.de('final')[0]!.falante).toBeNull()
  })

  it('usa os parâmetros padrão: abaixo de 1 s de fala não verifica', async () => {
    const canal = new CanalFalso()
    const abridor = new AbridorFalso()
    const extrator = new ExtratorFalso()
    const sessao = new Sessao(INICIO_PRESENCIAL, canal, { abrirUpstream: abridor.abrir, extrator })
    await sessao.abrir()
    sessao.pcm(pcmConstante(3000, AMPLITUDE.A))
    abridor.abertos[0]!.palavras([['Bom', 0.1, 0.9]], 1)
    await esperar()
    abridor.abertos[0]!.palavras([['Bom', 0.1, 0.9], ['dia', 1, 2.5]], 2)
    await esperar()
    expect(extrator.chamadas).toHaveLength(1)
  })

  it('recorta no máximo vozMaximaMs de uma frase longa', async () => {
    const { sessao, extrator, up } = await iniciar()
    sessao.pcm(pcmConstante(6000, AMPLITUDE.A))
    up.palavras([['longa', 0.1, 5.5]], 1)
    await esperar()
    expect(extrator.chamadas).toEqual([500 * 16, 500 * 16])
  })
})

describe('trocas de voz dentro da frase', () => {
  it('divide uma frase longa em janelas limitadas e emite cada palavra com a voz correta', async () => {
    const { sessao, canal, extrator, up } = await iniciar(INICIO_PRESENCIAL, { parametros: { ...SEM_ROTACAO, bufferMs: 30_000 } })
    sessao.pcm(pcmConstante(6000, AMPLITUDE.A))
    sessao.pcm(pcmConstante(6000, AMPLITUDE.B))
    sessao.pcm(pcmConstante(2000, AMPLITUDE.A))
    const segmentar = vi.spyOn(extrator, 'segmentar')
    up.palavras([['Olá', 0.1, 1], ['Bem', 2, 3], ['Paciente', 6.2, 7], ['Sim', 8, 9], ['Continuo', 10.1, 11], ['Perfeito', 12.1, 13]], 6)
    await esperar()
    expect(canal.de('final').map(final => [final.falante, final.palavras.map(palavra => palavra.texto)])).toEqual([
      ['profissional', ['Olá', 'Bem']], ['paciente', ['Paciente', 'Sim']],
      ['paciente', ['Continuo']], ['profissional', ['Perfeito']],
    ])
    expect(segmentar.mock.calls.every(([pcm]) => pcm.length <= 160000)).toBe(true)
  })

  it('expira palavras incertas quando o próprio áudio saiu da janela, sem chute posterior', async () => {
    const { sessao, canal, up } = await iniciar()
    sessao.pcm(pcmConstante(400, AMPLITUDE.B))
    up.palavras([['Oi', 0.1, 0.2]], 1)
    await esperar()
    sessao.pcm(pcmConstante(15000, AMPLITUDE.A))
    up.palavras([['Oi', 0.1, 0.2], ['Tudo bem', 14, 15]], 2)
    await esperar()
    expect(canal.de('final')[0]!.falante).toBeNull()
    expect(canal.de('falante')).toEqual([])
  })
})

describe('sessão online', () => {
  it('estampa o falante da trilha e não verifica nada', async () => {
    const { sessao, canal, extrator, up } = await iniciar({ modo: 'online', idioma: 'pt', falante: 'paciente' })
    sessao.pcm(pcmConstante(2000, AMPLITUDE.A))
    up.palavras([['Bom', 0.1, 1.5]], 1)
    await esperar()
    expect(canal.de('final')).toMatchObject([{ falante: 'paciente' }])
    expect(extrator.chamadas).toEqual([])
  })
})

describe('parciais', () => {
  it('manda a hipótese que mudou e repete o instante processado só de tempos em tempos', async () => {
    const { canal, up } = await iniciar()
    up.palavras([['Bom', 0.1, 0.4]], 0, 0.5)
    up.palavras([['Bom', 0.1, 0.4]], 0, 0.6)
    await esperar()
    expect(canal.de('parcial').map((parcial) => [parcial.texto, parcial.processado_ms])).toEqual([['Bom', 500]])
    up.palavras([['Bom', 0.1, 0.4]], 0, 1.2)
    await esperar()
    up.palavras([['Bom', 0.1, 0.4], ['dia', 0.5, 0.9]], 0, 1.3)
    await esperar()
    expect(canal.de('parcial').map((parcial) => [parcial.texto, parcial.processado_ms])).toEqual([['Bom', 500], ['Bom', 1200], ['Bom dia', 1300]])
  })

  it('manda o texto da frase em curso a cada mudança', async () => {
    const { canal, up } = await iniciar()
    up.palavras([], 0, 0.3, 'Bom')
    await esperar()
    up.palavras([], 0, 0.5, 'Bom di')
    await esperar()
    expect(canal.de('parcial').map((parcial) => parcial.texto)).toEqual(['Bom', 'Bom di'])
  })

  it('não manda parcial vazio no começo nem depois da frase final', async () => {
    const { sessao, canal, up } = await iniciar()
    sessao.pcm(pcmConstante(2000, AMPLITUDE.A))
    up.palavras([], 0, 0.1)
    await esperar()
    up.palavras([['Bom', 0.1, 1.5]], 0, 0.5)
    await esperar()
    up.palavras([['Bom', 0.1, 1.5]], 1, 0.6)
    await esperar()
    // O app limpa o parcial ao receber a frase final: o gateway não repete um parcial vazio.
    expect(canal.saidas.map((saida) => saida.type)).toEqual(['pronta', 'parcial', 'final'])
  })

  it('frase final vazia só limpa o parcial, sem mandar frase ao navegador', async () => {
    const { canal, up } = await iniciar()
    up.palavras([], 0, 0.3, 'Bom')
    await esperar()
    up.finalVazio()
    up.palavras([], 0, 0.5, 'Bom')
    await esperar()
    expect(canal.saidas.map((saida) => saida.type)).toEqual(['pronta', 'parcial', 'parcial'])
  })

  it('deixa de mandar parciais quando o navegador não acompanha', async () => {
    const { canal, up } = await iniciar()
    canal.cheio = true
    up.palavras([['Bom', 0.1, 0.4]], 0)
    await esperar()
    expect(canal.de('parcial')).toEqual([])
  })

  it('entrega parciais durante atribuição pendente e mantém o final serial', async () => {
    const { sessao, canal, extrator, up } = await iniciar()
    sessao.pcm(pcmConstante(2000, AMPLITUDE.A))
    const verificacao = adiado<Float32Array | null>()
    extrator.retorno = () => verificacao.promessa
    up.palavras([['Bom', 0.1, 1.5]], 1)
    up.palavras([['Bom', 0.1, 1.5], ['a', 1.6, 1.7]], 1)
    up.palavras([['Bom', 0.1, 1.5], ['a', 1.6, 1.7], ['b', 1.8, 1.9]], 1)
    up.palavras([['Bom', 0.1, 1.5], ['a', 1.6, 1.7], ['b', 1.8, 1.9], ['c', 2, 2.1]], 1)
    await esperar()
    expect(canal.de('parcial').at(-1)?.texto).toBe('Bom a b c')
    expect(canal.de('final')).toEqual([])
    verificacao.resolver(Float32Array.of(1, 0, 0, 0, 0, 0, 0, 0))
    await esperar()
    expect(canal.saidas.findIndex((saida) => saida.type === 'parcial'))
      .toBeLessThan(canal.saidas.findIndex((saida) => saida.type === 'final'))
    expect(canal.de('parcial').at(-1)?.texto).toBe('a b c')
    expect(canal.de('final')).toHaveLength(1)
  })
})

// Cada `segmentar` espera o teste liberar, na ordem: a frase fica na fila da verificação o tempo que o teste quiser.
function verificacaoManual(extrator: ExtratorFalso): () => void {
  const segmentar = extrator.segmentar.bind(extrator)
  const esperando: (() => void)[] = []
  extrator.segmentar = (pcm) => new Promise<void>((resolver) => esperando.push(resolver)).then(() => segmentar(pcm))
  return () => esperando.shift()!()
}

function resumo(saidas: Saida[]) {
  return saidas.slice(1).map((saida) => saida.type === 'parcial' ? [saida.ordem, saida.texto]
    : saida.type === 'final' ? [saida.ordem, saida.palavras.map((palavra) => palavra.texto)] : saida.type)
}

const BOM_DIA: [string, number, number][] = [['Bom', 0.1, 0.5], ['dia', 0.6, 1.5]]
const FINAL_BOM_DIA = { type: 'final', ordem: 0, frase: 0, falante: 'profissional', processado_ms: 1600,
  palavras: [{ texto: 'Bom', inicio_ms: 100, fim_ms: 500 }, { texto: 'dia', inicio_ms: 600, fim_ms: 1500 }] }

describe('frase na fila da verificação', () => {
  it('cada parcial leva a frase que espera antes da seguinte, e o primeiro depois da final sai sem ela', async () => {
    const { sessao, canal, extrator, up } = await iniciar()
    sessao.pcm(pcmConstante(3000, AMPLITUDE.A))
    const liberar = verificacaoManual(extrator)
    up.palavras(BOM_DIA, 2, 1.6)
    up.palavras([...BOM_DIA, ['Dor', 1.7, 2]], 2, 2)
    up.palavras([...BOM_DIA, ['Dor', 1.7, 2], ['forte', 2.1, 2.5]], 2, 2.6)
    await esperar()
    liberar()
    await esperar()
    up.palavras([...BOM_DIA, ['Dor', 1.7, 2], ['forte', 2.1, 2.5], ['agora', 2.6, 2.9]], 2, 3)
    expect(canal.saidas.slice(1)).toEqual([
      { type: 'parcial', ordem: 1, texto: 'Bom dia', processado_ms: 1600 },
      { type: 'parcial', ordem: 2, texto: 'Bom dia Dor', processado_ms: 2000 },
      { type: 'parcial', ordem: 3, texto: 'Bom dia Dor forte', processado_ms: 2600 },
      FINAL_BOM_DIA,
      { type: 'parcial', ordem: 4, texto: 'Dor forte', processado_ms: 2600 },
      { type: 'parcial', ordem: 5, texto: 'Dor forte agora', processado_ms: 3000 },
    ])
  })

  it('com duas frases na fila, o parcial leva as duas na ordem e perde cada uma quando ela sai', async () => {
    const { sessao, canal, extrator, up } = await iniciar()
    sessao.pcm(pcmConstante(4000, AMPLITUDE.A))
    const liberar = verificacaoManual(extrator)
    const ate: [string, number, number][] = [...BOM_DIA, ['Dor', 1.7, 2], ['forte', 2.1, 2.5], ['Tudo', 2.7, 3]]
    up.palavras(ate.slice(0, 4), 2, 1.6)
    up.palavras(ate, 4, 3)
    await esperar()
    liberar()
    await esperar()
    liberar()
    await esperar()
    expect(resumo(canal.saidas)).toEqual([
      [1, 'Bom dia Dor forte'],
      [3, 'Bom dia Dor forte Tudo'],
      [0, ['Bom', 'dia']],
      [4, 'Dor forte Tudo'],
      [2, ['Dor', 'forte']],
      [5, 'Tudo'],
    ])
  })

  it('frase longa verificada em partes: o parcial segura o resto até a última parte sair', async () => {
    const { sessao, canal, up } = await iniciar(INICIO_PRESENCIAL, { parametros: { ...SEM_ROTACAO, bufferMs: 30_000 } })
    sessao.pcm(pcmConstante(6000, AMPLITUDE.A))
    sessao.pcm(pcmConstante(6000, AMPLITUDE.B))
    sessao.pcm(pcmConstante(2000, AMPLITUDE.A))
    const frase: [string, number, number][] = [['Olá', 0.1, 1], ['Bem', 2, 3], ['Paciente', 6.2, 7], ['Sim', 8, 9],
      ['Continuo', 10.1, 11], ['Perfeito', 12.1, 13]]
    up.palavras(frase, 0, 13.5)
    up.palavras(frase, 6, 13.6)
    await esperar()
    expect(resumo(canal.saidas)).toEqual([
      [0, 'Olá Bem Paciente Sim Continuo Perfeito'],
      [1, ['Olá', 'Bem']], [1, ['Paciente', 'Sim']],
      [3, 'Continuo Perfeito'],
      [1, ['Continuo']], [1, ['Perfeito']],
      [4, ''],
    ])
  })

  it('a correção depois da final sai mesmo com o navegador ocupado, que senão veria a frase duas vezes', async () => {
    const { sessao, canal, extrator, up } = await iniciar()
    sessao.pcm(pcmConstante(3000, AMPLITUDE.A))
    const liberar = verificacaoManual(extrator)
    up.palavras([...BOM_DIA, ['Dor', 1.7, 2]], 2, 2)
    await esperar()
    canal.cheio = true
    up.palavras([...BOM_DIA, ['Dor', 1.7, 2], ['forte', 2.1, 2.5]], 2, 2.6)
    liberar()
    await esperar()
    expect(canal.saidas.slice(1)).toEqual([
      { type: 'parcial', ordem: 1, texto: 'Bom dia Dor', processado_ms: 2000 },
      { ...FINAL_BOM_DIA, processado_ms: 2000 },
      { type: 'parcial', ordem: 3, texto: 'Dor forte', processado_ms: 2600 },
    ])
  })

  it('a frase final que sai antes de qualquer parcial novo não gera parcial extra', async () => {
    const { sessao, canal, up } = await iniciar()
    sessao.pcm(pcmConstante(2000, AMPLITUDE.A))
    up.palavras(BOM_DIA, 0, 1.5)
    up.palavras(BOM_DIA, 2, 1.6)
    await esperar()
    expect(canal.saidas.slice(1)).toEqual([{ type: 'parcial', ordem: 0, texto: 'Bom dia', processado_ms: 1500 }, { ...FINAL_BOM_DIA, ordem: 1 }])
  })

  it('no modo online a frase sai na hora e o parcial seguinte só tem a frase em curso', async () => {
    const { canal, up } = await iniciar({ modo: 'online', idioma: 'pt', falante: 'paciente' })
    up.palavras([], 0, 0.3, 'Bom')
    up.palavras([...BOM_DIA, ['Dor', 1.7, 2]], 2, 2)
    up.palavras([...BOM_DIA, ['Dor', 1.7, 2]], 2, 2.1)
    await esperar()
    expect(canal.saidas.slice(1)).toEqual([
      { type: 'parcial', ordem: 0, texto: 'Bom', processado_ms: 300 },
      { ...FINAL_BOM_DIA, ordem: 1, falante: 'paciente', processado_ms: 2000 },
      { type: 'parcial', ordem: 2, texto: 'Dor', processado_ms: 2000 },
    ])
  })
})

describe('rotação da sessão upstream', () => {
  const COM_ROTACAO: Partial<Dependencias> = { parametros: PARAMETROS }

  it('renova antes do limite de duração observado no upstream', async () => {
    const { sessao, abridor, up } = await iniciar(INICIO_PRESENCIAL, { parametros: PARAMETROS_PADRAO })
    sessao.pcm(pcmConstante(PARAMETROS_PADRAO.rotacaoMs, AMPLITUDE.A))
    up.palavras([], 0)
    await esperar()
    expect(abridor.abertos).toHaveLength(2)
    expect(up.fechado).toBe(true)
  })

  it('numa pausa depois do tempo, abre outra sessão e mantém o relógio com o deslocamento', async () => {
    const { sessao, canal, abridor, up } = await iniciar(INICIO_PRESENCIAL, COM_ROTACAO)
    up.autoConfirmar = false
    sessao.pcm(pcmConstante(1200, AMPLITUDE.A))
    up.palavras([['Bom', 0.1, 0.5], ['dia', 0.6, 1.1]], 2, 1.2)
    await esperar()
    expect(up.confirmacoes).toBe(1)
    sessao.pcm(pcmConstante(160, AMPLITUDE.A))
    expect(up.amostras).toBe(1200 * 16)
    up.aoMensagem({ tipo: 'confirmado' })
    await esperar()
    expect(up.fechado).toBe(true)
    expect(abridor.abertos).toHaveLength(2)
    const novo = abridor.abertos[1]!
    expect(up.amostras).toBe(1200 * 16)
    expect(novo.amostras).toBe(160 * 16)
    sessao.pcm(pcmConstante(1000, AMPLITUDE.B))
    expect(novo.amostras).toBe(1160 * 16)
    novo.palavras([['Dor', 0.3, 0.9]], 1, 0.5)
    await esperar()
    expect(canal.de('final')[1]).toMatchObject({ ordem: expect.any(Number), frase: 1, falante: null, processado_ms: 1700,
      palavras: [{ texto: 'Dor', inicio_ms: 1500, fim_ms: 2100 }] })
  })

  it('não gira antes do tempo, nem no meio de uma frase', async () => {
    const { sessao, abridor, up } = await iniciar(INICIO_PRESENCIAL, COM_ROTACAO)
    sessao.pcm(pcmConstante(600, AMPLITUDE.A))
    up.palavras([], 0)
    await esperar()
    sessao.pcm(pcmConstante(1000, AMPLITUDE.A))
    up.palavras([['falando', 1.2, 1.5]], 0)
    await esperar()
    expect(up.confirmacoes).toBe(0)
    expect(abridor.abertos).toHaveLength(1)
  })

  it('gira mesmo no meio de uma frase quando passa do teto', async () => {
    const { sessao, abridor, up } = await iniciar(INICIO_PRESENCIAL, COM_ROTACAO)
    sessao.pcm(pcmConstante(3100, AMPLITUDE.A))
    up.palavras([['falando', 3, 3.1]], 0)
    await esperar()
    expect(abridor.abertos).toHaveLength(2)
  })

  it('não começa outra rotação enquanto uma está em curso', async () => {
    const { sessao, abridor, up } = await iniciar(INICIO_PRESENCIAL, COM_ROTACAO)
    up.autoConfirmar = false
    sessao.pcm(pcmConstante(1200, AMPLITUDE.A))
    up.palavras([], 0)
    up.palavras([], 0, 5)
    await esperar()
    expect(up.confirmacoes).toBe(1)
    up.aoMensagem({ tipo: 'confirmado' })
    await esperar()
    expect(abridor.abertos).toHaveLength(2)
  })

  it('falha a sessão se a nova upstream não abre', async () => {
    const { sessao, canal, abridor, registrar, up } = await iniciar(INICIO_PRESENCIAL, COM_ROTACAO)
    abridor.falhaNaProxima = new Error('sem vaga')
    sessao.pcm(pcmConstante(1200, AMPLITUDE.A))
    up.palavras([], 0)
    await esperar()
    expect(canal.de('erro')).toEqual([{ type: 'erro', mensagem: 'O serviço de transcrição falhou.' }])
    expect(canal.codigos).toEqual([1011])
    expect(registrar).toHaveBeenCalledWith('sessao.falha: sem vaga')
  })

  it('se a sessão acaba durante a rotação, fecha a upstream recém-aberta', async () => {
    const { sessao, abridor, up } = await iniciar(INICIO_PRESENCIAL, COM_ROTACAO)
    const liberar = adiado<void>()
    abridor.seguraProxima = liberar.promessa
    sessao.pcm(pcmConstante(1200, AMPLITUDE.A))
    up.palavras([], 0)
    await esperar()
    sessao.encerrar()
    liberar.resolver()
    await esperar()
    expect(abridor.abertos[1]!.fechado).toBe(true)
  })
})

describe('conclusão', () => {
  it('confirma o que sobrou, avisa concluída, fecha a upstream e a conexão', async () => {
    const { sessao, canal, up } = await iniciar()
    sessao.pcm(pcmConstante(2000, AMPLITUDE.A))
    const concluindo = sessao.concluir()
    await sessao.concluir()
    up.palavras([['Fim', 0.1, 1.5]], 1)
    await concluindo
    expect(up.confirmacoes).toBe(1)
    expect(canal.saidas.map((saida) => saida.type)).toEqual(['pronta', 'parcial', 'final', 'parcial', 'concluida'])
    expect(canal.codigos).toEqual([1000])
    expect(up.fechado).toBe(true)
    sessao.pcm(pcmConstante(80, 5))
    await sessao.concluir()
    expect(up.confirmacoes).toBe(1)
  })

  it('ignora áudio que chega depois de pedir a conclusão', async () => {
    const { sessao, up } = await iniciar()
    up.autoConfirmar = false
    const concluindo = sessao.concluir()
    sessao.pcm(pcmConstante(80, 5))
    expect(up.enviados).toHaveLength(0)
    await esperar()
    up.aoMensagem({ tipo: 'confirmado' })
    await concluindo
  })

  it('espera a rotação terminar antes de confirmar', async () => {
    const { sessao, canal, abridor, up } = await iniciar(INICIO_PRESENCIAL, { parametros: PARAMETROS })
    up.autoConfirmar = false
    sessao.pcm(pcmConstante(1200, AMPLITUDE.A))
    up.palavras([], 0)
    const concluindo = sessao.concluir()
    await esperar()
    expect(abridor.abertos).toHaveLength(1)
    up.aoMensagem({ tipo: 'confirmado' })
    await concluindo
    expect(abridor.abertos[1]!.confirmacoes).toBe(1)
    expect(canal.de('concluida')).toHaveLength(1)
  })

  it('falha a sessão se a upstream não aceita o commit', async () => {
    const { sessao, canal, up } = await iniciar()
    up.confirmar = () => { throw new Error('socket fechado') }
    await sessao.concluir()
    expect(canal.de('erro')).toHaveLength(1)
    expect(canal.codigos).toEqual([1011])
  })

  it('uma confirmação que ninguém pediu é ignorada', async () => {
    const { canal, up } = await iniciar()
    up.aoMensagem({ tipo: 'confirmado' })
    await esperar()
    expect(canal.saidas).toEqual([{ type: 'pronta' }])
  })
})

describe('falhas', () => {
  it('upstream que cai avisa o navegador e encerra tudo', async () => {
    const { canal, registrar, up } = await iniciar()
    up.aoFechar(new Error('caiu'))
    up.aoFechar(new Error('de novo'))
    expect(canal.de('erro')).toHaveLength(1)
    expect(canal.codigos).toEqual([1011])
    expect(up.fechado).toBe(true)
    expect(registrar).toHaveBeenCalledTimes(1)
  })

  it('extrator quebrado derruba a sessão sem citar o motivo ao navegador', async () => {
    const { sessao, canal, extrator, registrar, up } = await iniciar()
    sessao.pcm(pcmConstante(2000, AMPLITUDE.A))
    extrator.retorno = () => Promise.reject(new Error('worker caiu'))
    up.palavras([['Bom', 0.1, 1.5]], 1)
    await esperar()
    expect(canal.saidas.at(-1)).toEqual({ type: 'erro', mensagem: 'O serviço de transcrição falhou.' })
    expect(canal.codigos).toEqual([1011])
    expect(registrar).toHaveBeenCalledWith('sessao.falha: worker caiu')
  })

  it('registra falha de causa desconhecida e funciona sem registrador', async () => {
    const { sessao, canal, extrator, registrar, up } = await iniciar()
    sessao.pcm(pcmConstante(2000, AMPLITUDE.A))
    extrator.retorno = () => Promise.reject('texto solto')
    up.palavras([['Bom', 0.1, 1.5]], 1)
    await esperar()
    expect(registrar).toHaveBeenCalledWith('sessao.falha: desconhecida')
    expect(canal.codigos).toEqual([1011])

    const semRegistro = await iniciar(INICIO_PRESENCIAL, { registrar: undefined })
    semRegistro.up.aoFechar(new Error('x'))
    expect(semRegistro.canal.codigos).toEqual([1011])
  })
})

describe('encerramento', () => {
  it('descarta o que estava a caminho: nada sai depois e a impressão de voz já foi apagada', async () => {
    const { sessao, canal, extrator, up } = await iniciar()
    sessao.pcm(pcmConstante(2000, AMPLITUDE.A))
    const verificacao = adiado<Float32Array | null>()
    extrator.retorno = () => verificacao.promessa
    up.palavras([['Bom', 0.1, 1.5]], 1)
    up.palavras([['Bom', 0.1, 1.5], ['dia', 1.6, 1.9]], 2)
    await esperar()
    const antes = canal.saidas.length
    sessao.encerrar()
    verificacao.resolver(Float32Array.of(1, 0, 0, 0, 0, 0, 0, 0))
    await esperar()
    up.palavras([['x', 0, 1]], 1)
    sessao.pcm(pcmConstante(80, 5))
    await esperar()
    expect(canal.saidas.slice(antes)).toEqual([])
    expect(canal.de('final')).toEqual([])
    expect(up.fechado).toBe(true)
  })

  it('o fim da verificação depois de encerrar não identifica ninguém', async () => {
    const { sessao, canal, extrator, up } = await iniciar()
    sessao.pcm(pcmConstante(2000, AMPLITUDE.A))
    const verificacao = adiado<Float32Array | null>()
    extrator.retorno = () => verificacao.promessa
    up.palavras([['Bom', 0.1, 1.5]], 1)
    await esperar()
    sessao.encerrar()
    verificacao.resolver(Float32Array.of(1, 0, 0, 0, 0, 0, 0, 0))
    await esperar()
    expect(canal.de('final')).toEqual([])
  })
})
