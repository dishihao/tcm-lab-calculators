param(
  [string]$DataPath = (Join-Path $PSScriptRoot 'quality-template-extract.json')
)

$ErrorActionPreference = 'Stop'

function Normalize-Lines([string]$text) {
  return @(
    $text -split "[`r`v`a]" |
      ForEach-Object { ($_ -replace '\s+', ' ').Trim() } |
      Where-Object { $_ }
  )
}

function Find-Item($lines, [string]$itemId, [string]$headingPattern) {
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -notmatch $headingPattern) { continue }
    $end = [Math]::Min($lines.Count - 1, $i + 90)
    $method = ''
    $standard = ''
    for ($j = $i + 1; $j -le $end; $j++) {
      $line = $lines[$j]
      if (-not $method -and $line -match '(测定法|检查法).*(通则|测定|检查)') { $method = $line }
      if ($line -match '标准规定.*(不得|不应|不少于|应不|限度)') {
        $standard = $line
        break
      }
      if ($j -gt ($i + 3) -and $line -match '^(【检查】\s*)?(杂质|水分|总灰分|酸不溶性灰分|水溶性浸出物|醇溶性浸出物|浸出物|含量测定)(】|\s|$)') {
        break
      }
    }
    if ($standard) {
      return [pscustomobject]@{ item=$itemId; heading=$lines[$i]; method=$method; standard=$standard }
    }
  }
  return $null
}

$data = Get-Content -LiteralPath $DataPath -Raw -Encoding UTF8 | ConvertFrom-Json
$records = [System.Collections.Generic.List[object]]::new()
foreach ($record in $data.records) { $records.Add($record) }
$remainingErrors = [System.Collections.Generic.List[object]]::new()
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) 'tcm-quality-recover'
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $index = 0
  foreach ($entry in $data.errors) {
    $index++
    $tempPath = Join-Path $tempRoot ("recovered-{0:D2}.doc" -f $index)
    Copy-Item -LiteralPath $entry.file -Destination $tempPath -Force
    $doc = $null
    try {
      $doc = $word.Documents.Open($tempPath, $false, $true, $false)
      $lines = Normalize-Lines $doc.Content.Text
      $items = @(
        Find-Item $lines 'impurity' '^(【检查】\s*)?杂质(】|\s|$)'
        Find-Item $lines 'moisture' '^(【检查】\s*)?水分(\s|$|1\.)'
        Find-Item $lines 'ash' '^(【检查】\s*)?总灰分(\s|$|1\.)'
        Find-Item $lines 'extract' '^【?(水溶性|醇溶性)?浸出物】?'
      ) | Where-Object { $_ }
      $sourceFile = Get-Item -LiteralPath $entry.file
      $kind = if ($sourceFile.Directory.Name -eq '原料检验记录') { '原料' } else { '成品' }
      foreach ($item in $items) {
        $records.Add([pscustomobject]@{
          kind = $kind
          file = $sourceFile.Name
          fullPath = $sourceFile.FullName
          modified = $sourceFile.LastWriteTime.ToString('s')
          item = $item.item
          heading = $item.heading
          method = $item.method
          standard = $item.standard
        })
      }
      Write-Host ("Recovered {0}: {1} items" -f $sourceFile.Name, $items.Count)
    } catch {
      $remainingErrors.Add([pscustomobject]@{ file=$entry.file; error=$_.Exception.Message })
    } finally {
      if ($doc) { try { $doc.Close($false) } catch {} }
      if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
    }
  }
} finally {
  try { $word.Quit() } catch {}
  try { [Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
}

[pscustomobject]@{
  generatedAt = (Get-Date).ToString('s')
  records = $records
  errors = $remainingErrors
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $DataPath -Encoding UTF8

Write-Host ("Total records: {0}; remaining errors: {1}" -f $records.Count, $remainingErrors.Count)
