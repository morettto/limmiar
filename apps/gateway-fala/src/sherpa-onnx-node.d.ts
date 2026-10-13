declare module 'sherpa-onnx-node' {
  interface FluxoDeAudio { acceptWaveform(entrada: { samples: Float32Array; sampleRate: number }): void }
  interface ExtratorDeVoz { readonly dim: number; createStream(): FluxoDeAudio; isReady(fluxo: FluxoDeAudio): boolean; compute(fluxo: FluxoDeAudio): Float32Array }
  const sherpa: {
    SpeakerEmbeddingExtractor: new (configuracao: { model: string; numThreads: number; provider: string; debug: boolean }) => ExtratorDeVoz
  }
  export default sherpa
}
