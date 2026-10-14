declare module 'sherpa-onnx-node' {
  interface FluxoDeAudio { acceptWaveform(entrada: { samples: Float32Array; sampleRate: number }): void }
  interface ExtratorDeVoz { readonly dim: number; createStream(): FluxoDeAudio; isReady(fluxo: FluxoDeAudio): boolean; compute(fluxo: FluxoDeAudio): Float32Array }
  interface ConfigModelo { model: string; numThreads: number; provider: string; debug: boolean }
  interface Segmento { start: number; end: number; speaker: number }
  interface Diarizador { readonly sampleRate: number; process(pcm: Float32Array): Segmento[] }
  const sherpa: {
    SpeakerEmbeddingExtractor: new (configuracao: ConfigModelo) => ExtratorDeVoz
    OfflineSpeakerDiarization: new (configuracao: {
      segmentation: { pyannote: { model: string }; numThreads: number; provider: string; debug: boolean }
      embedding: ConfigModelo
      clustering: { numClusters: number; threshold: number }
      minDurationOn: number
      minDurationOff: number
    }) => Diarizador
  }
  export default sherpa
}
