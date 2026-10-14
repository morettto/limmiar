# Identidade vocal local

O cadastro de uma voz usa NVIDIA TitaNet Large, exportado pelo sherpa-onnx,
em WebAssembly no dispositivo. A sessão presencial identifica vozes no gateway,
com o mesmo modelo TitaNet e segmentação Pyannote nativa em threads próprias.
O wrapper chama somente a API pública da biblioteca; não implementa rede neural,
FFT, filtro mel nem extração de características.

Fontes: [NeMo e TitaNet no sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/nemo/index.html),
[modelo NVIDIA](https://huggingface.co/nvidia/speakerverification_en_titanet_large),
[API de embedding](https://k2-fsa.github.io/sherpa/onnx/c-api/html/speaker_embedding.html).

Entrada do wrapper: PCM float32 mono a 16.000 Hz, em memória. O único arquivo no
filesystem virtual é o modelo público `/titanet.onnx`. Áudio nunca vira arquivo.
O consumidor precisa limpar a entrada, liberar o embedding com `voice_release`
e destruir o extrator com `voice_destroy` ao encerrar. Saída sem valores finitos
ou sem norma é inválida. Nenhuma frase do cadastro é usada como identidade.

Build por revisão sherpa e digest Emscripten fixados no Dockerfile; o setup verifica
o hash do modelo e dos arquivos gerados. Os binários públicos ficam ignorados pelo Git:

```powershell
node tools/voice-identity/setup.mjs
```

Build e inferência no Chromium verificados. Quatro gravações Microsoft Speech
sintéticas independentes, duas por voz: 192 dimensões, similaridades de mesma voz
0,897 e 0,939; entre vozes 0,273 e 0,248. Inferências de aproximadamente 1,1–1,3 s.
Isso comprova o extrator local nessa fixture, não calibração humana.
Evidência: `.local/voice-identity-prova.json`.

O cadastro cifrado e a integração automática passaram depois em E2E real: perfil
recuperado em outro navegador, duas vozes sintéticas identificadas durante a captura
em 25,4 s, zero seleções manuais e zero uploads de áudio do cadastro. As telas desktop
e 375px passaram no axe. Evidência: `.local/voz-perfil-v1-prova.json` e
`.local/voz-perfil-v1-e2e.log`. O teste não qualifica vozes humanas nem o juiz clínico.

Modelo: NVIDIA TitaNet Large, exportação sherpa-onnx `nemo_en_titanet_large.onnx`,
101.405.493 bytes, SHA-256 `d51abcf31717ef28162f26acb9d44dd4127c3d44c9b8624f699f3425daca8e77`.
A licença original é [CC BY 4.0](https://huggingface.co/nvidia/speakerverification_en_titanet_large/blob/main/README.md).
NVIDIA é a autora dos pesos; o sherpa-onnx fornece a exportação e o runtime Apache 2.0.

## Separação no gateway

`node tools/voice-identity/setup-segmentacao.mjs` prepara somente o modelo público
Pyannote compatível com o sherpa-onnx instalado. O setup e a imagem Docker verificam
SHA-256 do arquivo e do modelo; ele fica no servidor, sem aumentar o bundle do app.
`pnpm dev` executa ambos os setups e configura `GATEWAY_FALA_SEGMENTACAO`.

Janelas de até 10 s mantêm o custo limitado. Cada intervalo tem suas próprias
amostras de voz; rótulos locais do segmentador não confirmam identidade. Intervalos
curtos ou sobrepostos ficam incertos, sem herdar a voz anterior. Nova identidade
exige profissional já reconhecido e duas amostras independentes consistentes.
O primeiro novo falante é paciente; acompanhantes conservam IDs separados e exigem
revisão do papel clínico. Em chamada com terceiros, confirmar quem é paciente.

127 testes do gateway passaram, cobertura 100%, incluindo dois falantes sintéticos
com modelos reais. Medição local de 12 janelas e 30 intervalos: 21 identificados
corretamente, 9 incertos, nenhum atribuído à pessoa errada; média 252 ms, máximo
315 ms por janela em CPU. Isso não qualifica microfone humano nem carga concorrente.
