import { describe, expect, it, vi } from 'vitest'
import { atribuirVozes, falanteNoInstante } from './atribuicao.ts'
import { Locutores } from './locutores.ts'
import { ExtratorFalso, VOZ_A } from './test-support/falsos.ts'

const audio = (...vozes: number[]) => Float32Array.from(vozes.flatMap(voz => Array(16000).fill(voz / 32768)))
const executar = (pcm: Float32Array, extrator = new ExtratorFalso(), locutores = new Locutores(VOZ_A)) =>
  atribuirVozes(pcm, 2000, 500, extrator, locutores)

describe('atribuição acústica de vozes', () => {
  it('separa duas vozes na mesma frase e mantém a identidade na troca seguinte', async () => {
    const trechos = await executar(audio(1000, 2000, 1000))
    expect(trechos.map(trecho => trecho.falante)).toEqual(['profissional', 'paciente', 'profissional'])
    expect(falanteNoInstante(trechos, 3500)).toBe('paciente')
    expect(falanteNoInstante(trechos, 0)).toBeNull()
  })

  it('confirma profissional antes de atribuir paciente mesmo quando este fala primeiro na janela', async () => {
    expect((await executar(audio(2000, 1000))).map(trecho => trecho.falante)).toEqual(['paciente', 'profissional'])
  })

  it('aguarda o profissional antes de cadastrar uma voz desconhecida', async () => {
    expect((await executar(audio(2000)))[0]!.falante).toBeNull()
  })

  it('não inventa identidade com áudio curto ou insuficiente para confirmação', async () => {
    const extrator = new ExtratorFalso()
    const locutores = new Locutores(VOZ_A)
    locutores.identificar(VOZ_A)
    const curto = new Float32Array(4000).fill(2000 / 32768)
    expect((await executar(curto, extrator, locutores))[0]!.falante).toBeNull()
    expect(extrator.chamadas).toEqual([])
    expect((await executar(new Float32Array(12000).fill(2000 / 32768), extrator, locutores))[0]!.falante).toBeNull()
    expect((await executar(new Float32Array(12000).fill(1000 / 32768)))[0]!.falante).toBe('profissional')
  })

  it('descarta impressão inválida em qualquer amostra obrigatória', async () => {
    for (const invalida of [0, 1]) {
      const extrator = new ExtratorFalso()
      let chamada = 0
      extrator.retorno = async () => chamada++ === invalida ? null : Float32Array.from(VOZ_A)
      expect((await executar(audio(1000), extrator))[0]!.falante).toBeNull()
    }
    const extrator = new ExtratorFalso()
    extrator.retorno = async () => null
    expect((await executar(new Float32Array(12000).fill(1000 / 32768), extrator))[0]!.falante).toBeNull()
  })

  it('não atribui o grupo inteiro quando a segmentação não separou duas vozes', async () => {
    const extrator = new ExtratorFalso()
    extrator.segmentar = async () => [{ start: 0, end: 2, speaker: 0 }]
    expect((await executar(audio(1000, 2000), extrator))[0]!.falante).toBeNull()
  })

  it('descarta mistura e não usa sobreposição para ensinar uma voz', async () => {
    const extrator = new ExtratorFalso()
    extrator.segmentar = async () => [{ start: 0, end: 1, speaker: 0 }, { start: 0.5, end: 1.5, speaker: 1 }]
    const trechos = await executar(audio(1000, 2000), extrator)
    expect(trechos.every(trecho => trecho.falante === null)).toBe(true)
    expect(falanteNoInstante(trechos, 2750)).toBeNull()
    expect(extrator.chamadas).toEqual([])
  })

  it('não aceita amostras que reconhecem vozes diferentes, mesmo com semelhança entre elas', async () => {
    const extrator = new ExtratorFalso()
    const locutores = new Locutores(VOZ_A)
    locutores.identificar(VOZ_A)
    const paciente = [0.1, 0.995, 0, 0, 0, 0, 0, 0]
    locutores.identificar(paciente, paciente)
    let chamada = 0
    extrator.retorno = async () => Float32Array.from(chamada++ === 0 ? [0.85, 0.527, 0, 0, 0, 0, 0, 0] : [0.527, 0.85, 0, 0, 0, 0, 0, 0])
    expect((await executar(audio(1000), extrator, locutores))[0]!.falante).toBeNull()
  })

  it('não copia identidade do cluster para um trecho curto de outra pessoa', async () => {
    const extrator = new ExtratorFalso()
    extrator.segmentar = async () => [{ start: 0, end: 0.25, speaker: 1 }, { start: 0.25, end: 2, speaker: 1 }]
    const pcm = new Float32Array(32000).fill(2000 / 32768)
    pcm.fill(1000 / 32768, 0, 4000)
    const locutores = new Locutores(VOZ_A)
    locutores.identificar(VOZ_A)
    expect((await executar(pcm, extrator, locutores)).map(trecho => trecho.falante)).toEqual([null, 'paciente'])
  })

  it('zera áudio e impressões locais, inclusive quando o extrator falha', async () => {
    const pcm = audio(1000)
    const extrator = new ExtratorFalso()
    const embedding = Float32Array.from(VOZ_A)
    extrator.retorno = vi.fn().mockResolvedValueOnce(embedding).mockRejectedValueOnce(new Error('quebrou'))
    await expect(executar(pcm, extrator)).rejects.toThrow('quebrou')
    expect(pcm.every(amostra => amostra === 0)).toBe(true)
    expect(embedding.every(amostra => amostra === 0)).toBe(true)
    const outro = audio(1000)
    extrator.segmentar = async () => { throw new Error('segmentação') }
    await expect(executar(outro, extrator)).rejects.toThrow('segmentação')
    expect(outro.every(amostra => amostra === 0)).toBe(true)
  })
})
