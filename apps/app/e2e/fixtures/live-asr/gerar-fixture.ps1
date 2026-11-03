param(
  [string]$CaminhoRoteiro = (Join-Path $PSScriptRoot 'roteiro.json'),
  [string]$Prefixo = (Join-Path $PSScriptRoot 'sessao-clinica')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
Add-Type -TypeDefinition @'
public static class Energia {
  public static double Rms(short[] a, int de, int ate) {
    if (de < 0) de = 0; if (ate > a.Length) ate = a.Length; if (ate <= de) return 0;
    double t = 0; for (int i = de; i < ate; i++) t += (double)a[i] * a[i];
    return System.Math.Sqrt(t / (ate - de));
  }
}
'@

$taxa = 16000
$porMs = $taxa / 1000
$silencio = [string][char]4
$formato = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo($taxa, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$roteiro = Get-Content -Raw -Encoding UTF8 $CaminhoRoteiro | ConvertFrom-Json

# WinRT word cues carry Duration 0, so word ends come from System.Speech PhonemeReached. System.Speech
# lists only Desktop voices; the OneCore tokens enter through the same internal VoiceInfo(ObjectToken)
# path it uses for those. Index the token list: @() would enumerate each token's registry subkeys.
function Add-VozesOneCore($sintetizador, [string[]]$nomes) {
  $asm = [System.Speech.Synthesis.SpeechSynthesizer].Assembly
  $np = [Reflection.BindingFlags]'NonPublic,Public,Static,Instance'
  $categoria = $asm.GetType('System.Speech.Internal.ObjectTokens.ObjectTokenCategory')
  $tipoToken = $asm.GetType('System.Speech.Internal.ObjectTokens.ObjectToken')
  $vs = $sintetizador.GetType().GetProperty('VoiceSynthesizer', $np).GetValue($sintetizador)
  $null = $sintetizador.GetInstalledVoices()
  $instaladas = $vs.GetType().GetField('_installedVoices', $np).GetValue($vs)
  $cat = $categoria.GetMethod('Create', $np).Invoke($null, [object[]]@('HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices'))
  $tokens = $categoria.GetMethod('FindMatchingTokens', $np).Invoke($cat, [object[]]@($null, $null))
  for ($i = 0; $i -lt $tokens.Count; $i++) {
    $arg = New-Object object[] 1; $arg[0] = $tokens[$i]
    $info = [System.Speech.Synthesis.VoiceInfo].GetConstructor($np, $null, [Type[]]@($tipoToken), $null).Invoke($arg)
    if ($nomes -notcontains $info.Name) { continue }
    $args2 = New-Object object[] 2; $args2[0] = $vs; $args2[1] = $info
    $instaladas.Add([System.Speech.Synthesis.InstalledVoice].GetConstructor($np, $null, [Type[]]@($vs.GetType(), [System.Speech.Synthesis.VoiceInfo]), $null).Invoke($args2))
  }
}

function Sintetizar($sintetizador, [string]$voz, [string]$texto) {
  $sintetizador.SelectVoice($voz)
  $palavras = New-Object System.Collections.ArrayList
  $fones = New-Object System.Collections.ArrayList
  $marcaSilencio = $silencio
  $aoFalar = [EventHandler[System.Speech.Synthesis.SpeakProgressEventArgs]]{ param($o, $e) [void]$palavras.Add(@($e.AudioPosition.TotalMilliseconds, $e.Text)) }.GetNewClosure()
  $aoFone = [EventHandler[System.Speech.Synthesis.PhonemeReachedEventArgs]]{ param($o, $e) [void]$fones.Add(@($e.AudioPosition.TotalMilliseconds, $e.Duration.TotalMilliseconds, ($e.Phoneme -eq $marcaSilencio))) }.GetNewClosure()
  $sintetizador.add_SpeakProgress($aoFalar)
  $sintetizador.add_PhonemeReached($aoFone)
  $buffer = New-Object IO.MemoryStream
  $sintetizador.SetOutputToAudioStream($buffer, $formato)
  $sintetizador.Speak($texto)
  $sintetizador.SetOutputToNull()
  $sintetizador.remove_SpeakProgress($aoFalar)
  $sintetizador.remove_PhonemeReached($aoFone)
  $bytes = $buffer.ToArray()
  $amostras = New-Object int16[] ($bytes.Length / 2)
  [Buffer]::BlockCopy($bytes, 0, $amostras, 0, $bytes.Length)

  $esperadas = [regex]::Matches($texto, '[\p{L}\p{N}]+').Count
  if ($palavras.Count -ne $esperadas) { throw "SpeakProgress deu $($palavras.Count) palavras, o texto tem ${esperadas}: $texto" }
  # Several PhonemeReached events can share one AudioPosition (one per IPA character of a phoneme); laid end to end they tile the audio.
  $linha = @(); $fim = 0.0
  foreach ($f in $fones) { $ini = [Math]::Max($f[0], $fim); $fim = $ini + $f[1]; $linha += , @($f[0], $fim, $f[2]) }
  $duracaoMs = $amostras.Length / $porMs
  if ([Math]::Abs($fim - $duracaoMs) -gt 25) { throw "Fonemas cobrem $fim ms, o audio tem $duracaoMs ms: $texto" }
  if (-not $linha[-1][2]) { throw "A fala nao termina em silencio do sintetizador: $texto" }

  $saida = @()
  for ($w = 0; $w -lt $palavras.Count; $w++) {
    $inicio = $palavras[$w][0]
    $proxima = if ($w + 1 -lt $palavras.Count) { $palavras[$w + 1][0] } else { [double]::MaxValue }
    $fins = @($linha | Where-Object { -not $_[2] -and $_[0] -ge $inicio -and $_[0] -lt $proxima } | ForEach-Object { $_[1] })
    if ($fins.Count -eq 0) { throw "Palavra sem fonema: $($palavras[$w][1])" }
    $saida += [pscustomobject]@{ text = $palavras[$w][1]; inicioMs = $inicio; fimMs = ($fins | Measure-Object -Maximum).Maximum }
  }
  for ($w = 0; $w -lt $saida.Count; $w++) {
    $p = $saida[$w]
    $pausaMs = if ($w + 1 -lt $saida.Count) { $saida[$w + 1].inicioMs - $p.fimMs } else { $duracaoMs - $p.fimMs }
    $fala = [Energia]::Rms($amostras, [int]($p.inicioMs * $porMs), [int]($p.fimMs * $porMs))
    if ($fala -lt 300) { throw "Palavra '$($p.text)' cai em silencio (RMS $fala)" }
    if ($pausaMs -ge 150) {
      $depois = [Energia]::Rms($amostras, [int](($p.fimMs + 30) * $porMs), [int](($p.fimMs + 100) * $porMs))
      if ($depois -gt 0.25 * $fala) { throw "Fim de '$($p.text)' antes de uma pausa nao bate com o audio (RMS $depois contra $fala)" }
    }
  }
  return @{ bytes = $bytes; palavras = $saida }
}

$sintetizador = New-Object System.Speech.Synthesis.SpeechSynthesizer
Add-VozesOneCore $sintetizador @($roteiro.vozes.profissional, $roteiro.vozes.paciente)
$pcm = New-Object IO.MemoryStream
$palavras = @()
foreach ($fala in $roteiro.falas) {
  $voz = $roteiro.vozes.($fala.quem)
  $deslocamento = $pcm.Length / 2
  $turno = Sintetizar $sintetizador $voz $fala.texto
  $pcm.Write($turno.bytes, 0, $turno.bytes.Length)
  foreach ($p in $turno.palavras) {
    $palavras += [pscustomobject][ordered]@{
      text = $p.text; speaker = $fala.quem
      startSample = [int]($deslocamento + [Math]::Round($p.inicioMs * $porMs))
      endSampleExclusive = [int]($deslocamento + [Math]::Round($p.fimMs * $porMs))
    }
  }
}
$sintetizador.Dispose()

$bytes = $pcm.ToArray()
[IO.File]::WriteAllBytes("$Prefixo.pcm", $bytes)
$sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
$manifesto = [ordered]@{
  schemaVersion = 2
  audio = [ordered]@{ file = [IO.Path]::GetFileName("$Prefixo.pcm"); sha256 = $sha; encoding = 'pcm_s16le'; sampleRate = $taxa; channels = 1; framesPerChannel = $bytes.Length / 2 }
  alignment = [ordered]@{
    method = 'synthesizer_word_boundaries'
    engine = "System.Speech $([System.Speech.Synthesis.SpeechSynthesizer].Assembly.GetName().Version) SpeakProgress + PhonemeReached"
    voices = $roteiro.vozes
    generatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    script = [IO.Path]::GetFileName($CaminhoRoteiro)
  }
  words = $palavras
}
[IO.File]::WriteAllText("$Prefixo.words.json", ($manifesto | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
"{0} palavras, {1:N1} s, sha256 {2}" -f $palavras.Count, ($bytes.Length / 2 / $taxa), $sha
