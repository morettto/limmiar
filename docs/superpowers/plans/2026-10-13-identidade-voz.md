# Identidade de voz no microfone compartilhado

Relato confirmado: profissional e paciente no mesmo microfone, modo presencial. Uma comparação de 1 s pode criar identidades falsas; uma frase ASR inteira pode conter duas vozes. A UI também renomeava pacientes confirmados.

- [x] Reproduzir janelas curtas e frases mistas com TitaNet instalado, sem áudio humano persistido.
- [x] Preservar o papel confirmado na UI e rejeitar promoção automática de desconhecidos a paciente.
- [x] Ancorar profissional no perfil cadastrado, aprender variantes confirmadas e exigir amostras consistentes para novas identidades.
- [x] Segmentar acusticamente com sherpa-onnx/Pyannote já suportados pela dependência; atribuir palavras a trechos separados e deixar ambiguidades explícitas.
- [x] Validar duas vozes, respostas curtas, terceira voz, fala mista, cancelamento, modo online e limpeza de memória.
- [x] Executar checks afetados e disponibilizar ambiente para repetir voz humana.

Áudio e perfis de sessão permanecem em RAM. Não gravar embeddings nem falas nos logs. Não reduzir o limiar para esconder falhas; não impor duas pessoas artificialmente. O modo online conserva os papéis das trilhas autenticadas. Uma biometria incerta deve permanecer incerta, não produzir uma certeza clínica falsa.

Fonte da implementação nativa: https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html e API JavaScript da versão sherpa-onnx-node já instalada.
