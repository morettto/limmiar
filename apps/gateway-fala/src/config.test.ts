import { describe, expect, it } from 'vitest'
import { lerConfig } from './config.ts'

describe('lerConfig', () => {
  it('usa os padrões de desenvolvimento', () => {
    expect(lerConfig({ GATEWAY_FALA_SEGMENTACAO: '/seg.onnx', GATEWAY_FALA_MODELO: '/m/titanet.onnx' })).toEqual({
      host: '127.0.0.1', porta: 8090, chave: undefined, modelo: '/m/titanet.onnx', modeloSegmentacao: '/seg.onnx', threads: 2,
      nemotronUrls: ['ws://127.0.0.1:8080/v1/audio/transcriptions/realtime'], sessoesPorInstancia: 2, nemotronChave: undefined,
    })
  })

  it('lê as chaves, o endereço e o tamanho do pool do ambiente', () => {
    expect(lerConfig({ GATEWAY_FALA_SEGMENTACAO: '/seg.onnx', GATEWAY_FALA_MODELO: '/m.onnx', GATEWAY_FALA_HOST: '0.0.0.0', GATEWAY_FALA_PORTA: '9000', GATEWAY_FALA_THREADS: '4',
      GATEWAY_FALA_CHAVE: 'k1', NEMOTRON_URLS: 'ws://nemo1:8080/x, ws://nemo2:8080/x', NEMOTRON_SESSOES_POR_INSTANCIA: '3', NEMOTRON_CHAVE: 'k2' })).toEqual({
      host: '0.0.0.0', porta: 9000, chave: 'k1', modelo: '/m.onnx', modeloSegmentacao: '/seg.onnx', threads: 4, nemotronUrls: ['ws://nemo1:8080/x', 'ws://nemo2:8080/x'], sessoesPorInstancia: 3, nemotronChave: 'k2',
    })
  })

  it('exige o modelo e números inteiros positivos', () => {
    expect(() => lerConfig({})).toThrow(/GATEWAY_FALA_MODELO/)
    expect(() => lerConfig({ GATEWAY_FALA_MODELO: '/m' })).toThrow(/GATEWAY_FALA_SEGMENTACAO/)
    expect(() => lerConfig({ GATEWAY_FALA_SEGMENTACAO: '/seg.onnx', GATEWAY_FALA_MODELO: '/m', GATEWAY_FALA_PORTA: 'abc' })).toThrow(/GATEWAY_FALA_PORTA/)
    expect(() => lerConfig({ GATEWAY_FALA_SEGMENTACAO: '/seg.onnx', GATEWAY_FALA_MODELO: '/m', GATEWAY_FALA_THREADS: '0' })).toThrow(/GATEWAY_FALA_THREADS/)
    expect(lerConfig({ GATEWAY_FALA_SEGMENTACAO: '/seg.onnx', GATEWAY_FALA_MODELO: '/m', GATEWAY_FALA_PORTA: '' }).porta).toBe(8090)
  })
})
