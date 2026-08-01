param(
  [string]$WorkspaceRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$OutputPath = (Join-Path $PSScriptRoot 'identification-template-extract.json'),
  [ValidateSet('All','Raw','Finished')]
  [string]$Scope = 'All',
  [int]$StartIndex = 0,
  [int]$MaxFiles = 0
)

$ErrorActionPreference = 'Stop'
$recordRoot = Split-Path -Parent $WorkspaceRoot
$roots = @(
  @{ Path = (Join-Path $recordRoot '原料检验记录'); Kind = '原料' },
  @{ Path = (Join-Path $recordRoot '成品检验记录'); Kind = '成品' }
)
if ($Scope -eq 'Raw') { $roots = @($roots | Where-Object Kind -eq '原料') }
if ($Scope -eq 'Finished') { $roots = @($roots | Where-Object Kind -eq '成品') }

function Normalize-Lines([string]$text) {
  $result = [System.Collections.Generic.List[string]]::new()
  foreach ($part in ($text -split "[`r`v`a]")) {
    $line = ($part -replace '\s+', ' ').Trim()
    if (-not $line) { continue }
    $line = $line -replace '_{8,}', '____'
    if ($result.Count -eq 0 -or $result[$result.Count - 1] -ne $line) {
      $result.Add($line)
    }
  }
  return @($result)
}

function Heading-Type([string]$line) {
  if (-not $line) { return '' }
  if ($line -match '生物显微镜型号|显微镜编号') { return '' }
  if ($line.Length -le 140 -and $line -match '显微(特征|鉴别|检查)') { return 'microscopy' }
  if ($line.Length -le 180 -and $line -match '(薄层色谱|薄层鉴别)') { return 'tlc' }
  if ($line.Length -le 180 -and $line -match '(理化(鉴别|检查|反应)?|化学(鉴别|反应))') { return 'physicochemical' }
  return ''
}

function Is-Major-Heading([string]$line) {
  if ($line -match '【(性状|检查|含量测定|浸出物)】') { return $true }
  return $line -match '^(【?(性状|检查|含量测定|浸出物|杂质|水分|总灰分|酸不溶性灰分|二氧化硫残留量)】?)(\s|$|（|\(|\d+[.、])'
}

function Clean-Block-Line([string]$line) {
  $clean = $line
  $clean = $clean -replace '检验人/日期：\s*_+\s*复核人/日期：\s*_+', ''
  $clean = $clean -replace '^检验人/日期：.*?复核人/日期：.*?(?=【鉴别】|（\d+）|\(\d+\))', ''
  return ($clean -replace '\s+', ' ').Trim()
}

function Find-Blocks($lines, [string]$itemId) {
  $headings = [System.Collections.Generic.List[object]]::new()
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $type = Heading-Type $lines[$i]
    if ($type) {
      $headings.Add([pscustomobject]@{ Index = $i; Type = $type })
    }
  }

  # Some records contain the TLC method without a short standalone heading.
  if ($itemId -eq 'tlc' -and -not ($headings | Where-Object Type -eq 'tlc')) {
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match '照薄层色谱法（?通则\s*0502') {
        $headings.Add([pscustomobject]@{ Index = $i; Type = 'tlc' })
        break
      }
    }
  }

  $headings = @($headings | Sort-Object Index -Unique)
  $blocks = [System.Collections.Generic.List[object]]::new()
  for ($h = 0; $h -lt $headings.Count; $h++) {
    $heading = $headings[$h]
    if ($heading.Type -ne $itemId) { continue }
    $start = [int]$heading.Index
    $end = [Math]::Min($lines.Count - 1, $start + 100)
    if (($h + 1) -lt $headings.Count) {
      $end = [Math]::Min($end, [int]$headings[$h + 1].Index - 1)
    }

    $content = [System.Collections.Generic.List[string]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new()
    for ($i = $start; $i -le $end; $i++) {
      $line = Clean-Block-Line $lines[$i]
      if (-not $line) { continue }
      if ($i -gt $start -and (Is-Major-Heading $line)) { break }
      if ($line -match '^(检验人|复核人|结论：|室温：|相对湿度：)') { continue }
      if ($seen.Add($line)) { $content.Add($line) }
    }
    if ($content.Count -gt 0) {
      $title = $content[0]
      $body = if ($content.Count -gt 1) { @($content | Select-Object -Skip 1) } else { @($content[0]) }
      $blocks.Add([pscustomobject]@{ title = $title; lines = $body })
    }
  }
  return @($blocks)
}

$results = [System.Collections.Generic.List[object]]::new()
$errors = [System.Collections.Generic.List[object]]::new()
$ambiguous = [System.Collections.Generic.List[object]]::new()
$processedFiles = 0
$selectedFileCount = 0
$scopeFileCount = 0

function New-WordApplication {
  $app = New-Object -ComObject Word.Application
  $app.Visible = $false
  $app.DisplayAlerts = 0
  try { $app.AutomationSecurity = 3 } catch {}
  try { $app.Options.UpdateLinksAtOpen = $false } catch {}
  return $app
}

function Save-Results {
  [pscustomobject]@{
    generatedAt = (Get-Date).ToString('s')
    records = $results
    ambiguous = $ambiguous
    errors = $errors
    scan = [pscustomobject]@{
      scope = $Scope
      startIndex = $StartIndex
      maxFiles = $MaxFiles
      scopeFileCount = $scopeFileCount
      selectedFileCount = $selectedFileCount
      processedFiles = $processedFiles
    }
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}

$scopeFiles = @(foreach ($root in $roots) {
  Get-ChildItem -LiteralPath $root.Path -File -Recurse |
    Where-Object { $_.Extension -in '.doc', '.docx' } |
    ForEach-Object { [pscustomobject]@{ File = $_; Kind = $root.Kind } }
})
$scopeFileCount = $scopeFiles.Count
$files = @($scopeFiles | Select-Object -Skip $StartIndex)
if ($MaxFiles -gt 0) { $files = @($files | Select-Object -First $MaxFiles) }
$selectedFileCount = $files.Count

$word = New-WordApplication
try {
  for ($count = 0; $count -lt $files.Count; $count++) {
    $entry = $files[$count]
    $document = $null
    $temporaryDoc = $null
    try {
      try {
        $document = $word.Documents.Open($entry.File.FullName, $false, $true, $false)
      } catch {
        if ($entry.File.Extension -ne '.docx' -or $_.Exception.Message -notmatch '文件格式与文件扩展名不匹配') {
          throw
        }
        $temporaryDoc = Join-Path ([IO.Path]::GetTempPath()) ("tcm-identification-{0}.doc" -f [guid]::NewGuid())
        Copy-Item -LiteralPath $entry.File.FullName -Destination $temporaryDoc -Force
        $document = $word.Documents.Open($temporaryDoc, $false, $true, $false)
      }
      $lines = Normalize-Lines $document.Content.Text
      foreach ($item in @('microscopy','tlc','physicochemical')) {
        $blocks = @(Find-Blocks $lines $item)
        if ($blocks.Count -gt 0) {
          $results.Add([pscustomobject]@{
            kind = $entry.Kind
            file = $entry.File.Name
            modified = $entry.File.LastWriteTime.ToString('s')
            item = $item
            blocks = $blocks
          })
        }
      }

      $checks = @(
        @{ Item='microscopy'; Pattern='显微(特征|鉴别|检查)' },
        @{ Item='tlc'; Pattern='薄层色谱|通则\s*0502' },
        @{ Item='physicochemical'; Pattern='理化(鉴别|检查|反应)?|化学(鉴别|反应)' }
      )
      foreach ($check in $checks) {
        $hasKeyword = @($lines | Where-Object { $_ -match $check.Pattern }).Count -gt 0
        $hasResult = @($results | Where-Object { $_.file -eq $entry.File.Name -and $_.kind -eq $entry.Kind -and $_.item -eq $check.Item }).Count -gt 0
        if ($hasKeyword -and -not $hasResult) {
          $ambiguous.Add([pscustomobject]@{ kind=$entry.Kind; file=$entry.File.Name; item=$check.Item })
        }
      }
    } catch {
      $errors.Add([pscustomobject]@{ kind=$entry.Kind; file=$entry.File.Name; error=$_.Exception.Message })
    } finally {
      if ($document) { try { $document.Close($false) } catch {} }
      if ($temporaryDoc -and (Test-Path -LiteralPath $temporaryDoc)) {
        Remove-Item -LiteralPath $temporaryDoc -Force
      }
    }

    $done = $count + 1
    $processedFiles = $done
    if (($done % 50) -eq 0 -or $done -eq $files.Count) {
      Write-Host ("Processed {0}/{1}; templates {2}; ambiguous {3}; errors {4}" -f $done, $files.Count, $results.Count, $ambiguous.Count, $errors.Count)
    }
  }
} finally {
  Save-Results
  try { $word.Quit() } catch {}
  try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null } catch {}
}

Write-Host ("Extracted {0} item records; {1} ambiguous; {2} document errors" -f $results.Count, $ambiguous.Count, $errors.Count)
Write-Host $OutputPath
