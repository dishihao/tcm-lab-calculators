param(
  [string]$WorkspaceRoot = '',
  [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Get-Location).Path
if (-not $WorkspaceRoot) { $WorkspaceRoot = $projectRoot }
if (-not $OutputPath) { $OutputPath = Join-Path $projectRoot 'tools\hplc-template-extract.json' }
$roots = @(
  @{ Path = (Join-Path (Split-Path -Parent $WorkspaceRoot) '原料检验记录'); Kind = '原料' },
  @{ Path = (Join-Path (Split-Path -Parent $WorkspaceRoot) '成品检验记录'); Kind = '成品' }
)

function Get-ProductName([string]$name) {
  $base = [IO.Path]::GetFileNameWithoutExtension($name)
  $base = $base -replace '^\d+', ''
  $base = $base -replace '(原料|成品)?(质量标准|检验记).*$',''
  return ($base -replace '\s+', '').Trim(' ', '.', '。', '-', '_')
}

function Get-RecordLabel([string]$name, [string]$kind) {
  $base = [IO.Path]::GetFileNameWithoutExtension($name)
  $marker = [regex]::Match($base, '(原料|成品)?(质量标准|检验记(?:录)?)')
  if (-not $marker.Success) { return $kind }
  $suffix = $base.Substring($marker.Index + $marker.Length)
  $suffix = ($suffix -replace '^[\s._-]+|[\s._-]+$', '') -replace '\(\d+\)$', ''
  $suffix = $suffix -replace '(?<=[）)])\s*[123]$', ''
  $suffix = $suffix -replace '^\d+$', ''
  if (-not $suffix) { return $kind }
  return "$kind$suffix"
}

function Normalize-Section([string]$text) {
  return (($text -replace "[`r`v`a]+", "`n") -replace "[`t ]+", " ").Trim()
}

function Find-HplcSections([string]$text) {
  $starts = [System.Collections.Generic.List[int]]::new()
  foreach ($hit in [regex]::Matches($text, '高效液相色谱法|通则\s*[（(]?\s*0?512\s*[）)]?')) {
    $tailLength = [Math]::Min(12000, $text.Length - $hit.Index)
    $tail = $text.Substring($hit.Index, $tailLength)
    if ($tail -notmatch '对照品' -or $tail -notmatch '供试品' -or
        $tail -notmatch '结果与计算|数据记录及计算') { continue }

    $lineStart = 0
    foreach ($separator in @("`r", "`v", "`n")) {
      $candidate = $text.LastIndexOf($separator, $hit.Index)
      if ($candidate -ge $lineStart) { $lineStart = $candidate + 1 }
    }
    $assayStart = $text.LastIndexOf('含量测定', $hit.Index)
    if ($assayStart -ge 0 -and ($hit.Index - $assayStart) -le 500) {
      $lineStart = $assayStart
    }
    $starts.Add($lineStart)
  }
  $uniqueStarts = @($starts | Sort-Object -Unique)
  $sections = [System.Collections.Generic.List[string]]::new()
  for ($i = 0; $i -lt $uniqueStarts.Count; $i++) {
    $start = $uniqueStarts[$i]
    $end = if (($i + 1) -lt $uniqueStarts.Count) {
      $uniqueStarts[$i + 1]
    } else {
      [Math]::Min($text.Length, $start + 60000)
    }
    $segment = $text.Substring($start, $end - $start)
    $endMarker = [regex]::Match($segment.Substring([Math]::Min(4, $segment.Length)),
      '(?m)(结论\s*[：:]|【性味与归经】|【性味】|【归经】|【功能与主治】|【功能主治】|【用法与用量】|【用法用量】|【贮藏】|【包装】)')
    if ($endMarker.Success) {
      $segment = $segment.Substring(0, $endMarker.Index + [Math]::Min(4, $segment.Length))
    }
    $sections.Add((Normalize-Section $segment))
  }
  return $sections
}

function Open-ReadOnlyDocument($word, $file, [string]$tempRoot) {
  try {
    return [pscustomobject]@{
      Document = $word.Documents.Open($file.FullName, $false, $true, $false)
      TempPath = $null
    }
  } catch {
    $tempPath = Join-Path $tempRoot ("recovered-{0}.doc" -f ([guid]::NewGuid().ToString('N')))
    Copy-Item -LiteralPath $file.FullName -Destination $tempPath -Force
    return [pscustomobject]@{
      Document = $word.Documents.Open($tempPath, $false, $true, $false)
      TempPath = $tempPath
    }
  }
}

$records = [System.Collections.Generic.List[object]]::new()
$errors = [System.Collections.Generic.List[object]]::new()
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) 'tcm-hplc-extract'
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

function Save-Results {
  [pscustomobject]@{
    generatedAt = (Get-Date).ToString('s')
    records = $records
    errors = $errors
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $entries = foreach ($root in $roots) {
    Get-ChildItem -LiteralPath $root.Path -Recurse -File |
      Where-Object { $_.Extension -in '.doc', '.docx' } |
      ForEach-Object { [pscustomobject]@{ File = $_; Kind = $root.Kind } }
  }

  $index = 0
  foreach ($entry in $entries) {
    $index++
    if (($index % 100) -eq 0) {
      Write-Host ("Processed {0}/{1}" -f $index, $entries.Count)
    }
    $opened = $null
    try {
      $opened = Open-ReadOnlyDocument $word $entry.File $tempRoot
      $sections = @(Find-HplcSections $opened.Document.Content.Text)
      $sectionIndex = 0
      foreach ($section in $sections) {
        $sectionIndex++
        $records.Add([pscustomobject]@{
          kind = $entry.Kind
          product = Get-ProductName $entry.File.Name
          recordLabel = Get-RecordLabel $entry.File.Name $entry.Kind
          file = $entry.File.Name
          fullPath = $entry.File.FullName
          modified = $entry.File.LastWriteTime.ToString('s')
          sectionIndex = $sectionIndex
          section = $section
        })
      }
    } catch {
      $errors.Add([pscustomobject]@{ file=$entry.File.FullName; error=$_.Exception.Message })
    } finally {
      if ($opened -and $opened.Document) { try { $opened.Document.Close($false) } catch {} }
      if ($opened -and $opened.TempPath -and (Test-Path -LiteralPath $opened.TempPath)) {
        Remove-Item -LiteralPath $opened.TempPath -Force
      }
    }

    if (($index % 100) -eq 0) { Save-Results }
    if (($index % 200) -eq 0) {
      try { $word.Quit() } catch {}
      try { [Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
      $word = New-Object -ComObject Word.Application
      $word.Visible = $false
      $word.DisplayAlerts = 0
    }
  }
} finally {
  try { $word.Quit() } catch {}
  try { [Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
  Save-Results
}

Write-Host ("Extracted {0} HPLC record sections; {1} errors" -f $records.Count, $errors.Count)
