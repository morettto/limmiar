param([Parameter(Mandatory)][string]$Texto, [Parameter(Mandatory)][string]$Saida, [string]$Voz = 'MSTTS_V110_ptBR_DanielM')
$ErrorActionPreference = 'Stop'
$voice = New-Object -ComObject SAPI.SpVoice
$token = New-Object -ComObject SAPI.SpObjectToken
$token.SetId("HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\$Voz")
$voice.Voice = $token
$stream = New-Object -ComObject SAPI.SpFileStream
$stream.Format.Type = 22
$stream.Open([IO.Path]::GetFullPath($Saida), 3)
try {
    $voice.AudioOutputStream = $stream
    $voice.Speak([IO.File]::ReadAllText([IO.Path]::GetFullPath($Texto))) | Out-Null
} finally {
    $stream.Close()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($stream)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($token)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($voice)
}
