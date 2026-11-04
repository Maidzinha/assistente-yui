# Copia as configurações da Yui da pasta isolada do app Claude para a pasta real do Windows.
# Precisa rodar FORA do Claude (aberto pelo Explorador), senão a cópia cai de novo na pasta isolada.
$ErrorActionPreference = 'Stop'
$origem = Join-Path $env:LOCALAPPDATA 'Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Assistente'
$destino = Join-Path $env:APPDATA 'Assistente'
$log = Join-Path $PSScriptRoot 'copiar-dados.log'
try {
  Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*Assistente-Yui*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  New-Item -ItemType Directory -Force $destino | Out-Null
  $backup = Join-Path $destino ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Force $backup | Out-Null
  $arquivos = 'settings.json', 'secrets.json', 'Local State', 'conversations.json', 'memoria.json', 'uso.json', 'yui.vrm'
  $copiados = @()
  foreach ($a in $arquivos) {
    $real = Join-Path $destino $a
    if (Test-Path $real) { Copy-Item $real (Join-Path $backup $a) -Force }
    $novo = Join-Path $origem $a
    if (Test-Path $novo) { Copy-Item $novo $real -Force; $copiados += $a }
  }
  "OK $(Get-Date -Format s) | destino=$destino | copiados: $($copiados -join ', ') | backup=$backup" | Set-Content $log -Encoding UTF8
} catch {
  "ERRO $(Get-Date -Format s) | $($_.Exception.Message)" | Set-Content $log -Encoding UTF8
}
