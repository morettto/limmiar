# Áudio sintético de verificação

`maria-3s.pcm` e o embedding WASM correspondente verificam equivalência de TitaNet.
`maria-zira-10s.pcm` contém 10 s de duas vozes Microsoft Speech sintéticas,
recortadas entre 18 s e 28 s do diálogo local de teste: Maria, pausa e Zira.
PCM16 little-endian, mono, 16 kHz; nenhuma gravação de paciente ou profissional.

O teste nativo compara os papéis dentro de uma única janela, conserva uma fala
curta incerta e rejeita atribuição de uma troca abrupta que a segmentação não separou.
Os modelos públicos são preparados pelos scripts em tools/voice-identity.
