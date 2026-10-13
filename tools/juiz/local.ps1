# Sobe o juiz local (llama-server: Gemma 4 E4B Q4_K_M + LoRA) e imprime as variáveis do `pnpm dev`.
# Uso, da raiz do repositório: .\tools\juiz\local.ps1 [-Ngl 99] [-Versao v2]. Passo a passo e conversão do LoRA: tools/juiz/README.md.
param(
    [string]$Bin = "$PSScriptRoot\..\..\.local\llamacpp\bin12",
    [string]$Versao = 'v2',
    [int]$Ngl = 99,
    [int]$Porta = 8100
)
$ErrorActionPreference = 'Stop'

$gguf = Join-Path $PSScriptRoot '..\..\mvp-copiloto\modelos\gguf'
$servidor = Join-Path $Bin 'llama-server.exe'
$base = Join-Path $gguf 'gemma-4-E4B-it-Q4_K_M.gguf'
$lora = Join-Path $gguf "juiz-$Versao-lora-f16.gguf"
foreach ($arquivo in $servidor, $base, $lora) {
    if (-not (Test-Path $arquivo)) { throw "Falta $arquivo (tools/juiz/README.md, 'Servir na GPU local')." }
}
if (Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue) { throw "A porta $Porta já está em uso." }

if ($env:COPILOTO_JUIZ_CHAVE) { $chave = $env:COPILOTO_JUIZ_CHAVE } else {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $chave = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

# A chave vai por variável de ambiente (LLAMA_API_KEY) para não aparecer na linha de comando do processo.
# O adaptador carrega desligado (escala 0); cada pedido do juiz liga o id 0 pelo campo "lora".
$env:LLAMA_API_KEY = $chave
$log = Join-Path $PSScriptRoot '..\..\.local\juiz-local.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$argumentos = @('-m', "`"$base`"", '--lora', "`"$lora`"", '--lora-init-without-apply', '-ngl', $Ngl, '-c', 3072, '-fa', 'on',
    '-np', 1, '--host', '127.0.0.1', '--port', $Porta, '--alias', 'juiz')
$processo = Start-Process $servidor -ArgumentList $argumentos -WindowStyle Hidden -PassThru -RedirectStandardError $log -RedirectStandardOutput "$log.out"
Remove-Item Env:LLAMA_API_KEY

# /health responde 503 enquanto o modelo carrega; Invoke-WebRequest lança nesse caso.
for ($i = 0; $i -lt 120; $i++) {
    if ($processo.HasExited) { throw "O llama-server saiu (código $($processo.ExitCode)); veja $log." }
    try { if ((Invoke-WebRequest "http://127.0.0.1:$Porta/health" -UseBasicParsing).StatusCode -eq 200) { break } } catch { Start-Sleep 2 }
}
if ($i -eq 120) { Stop-Process -Id $processo.Id; throw "O llama-server não ficou saudável em 4 minutos; veja $log." }

"Juiz no ar (pid $($processo.Id)). Na janela do ``pnpm dev``:"
"`$env:COPILOTO_JUIZ_URL            = 'http://127.0.0.1:$Porta'"
"`$env:COPILOTO_JUIZ_CHAVE          = '$chave'"
"`$env:COPILOTO_JUIZ_VERSAO         = '$Versao'"
"`$env:COPILOTO_JUIZ_MODELO         = 'juiz'"
"`$env:COPILOTO_BASE_MODELO         = 'juiz'"
"`$env:COPILOTO_REESCRITA_MODELO    = 'juiz'"
"Encerrar: Stop-Process -Id $($processo.Id)"
