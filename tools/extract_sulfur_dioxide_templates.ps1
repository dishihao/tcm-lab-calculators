param(
  [string]$WorkspaceRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$OutputPath = (Join-Path $PSScriptRoot 'sulfur-dioxide-template-extract.json')
)

$ErrorActionPreference = 'Stop'
$roots = @(
  @{ Path = (Join-Path (Split-Path -Parent $WorkspaceRoot) '原料检验记录'); Kind = '原料' },
  @{ Path = (Join-Path (Split-Path -Parent $WorkspaceRoot) '成品检验记录'); Kind = '成品' }
)

function Normalize-Lines([string]$text) {
  return @(
    $text -split "[`r`v`a]" |
      ForEach-Object { ($_ -replace '\s+', ' ').Trim() } |
      Where-Object { $_ }
  )
}

function New-WordApplication {
  $app = New-Object -ComObject Word.Application
  $app.Visible = $false
  $app.DisplayAlerts = 0
  return $app
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
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) 'tcm-sulfur-dioxide-extract'
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$word = New-WordApplication
try {
  $files = foreach ($root in $roots) {
    Get-ChildItem -LiteralPath $root.Path -File -Recurse |
      Where-Object { $_.Extension -in '.doc', '.docx' } |
      ForEach-Object { [pscustomobject]@{ File = $_; Kind = $root.Kind } }
  }

  $count = 0
  foreach ($entry in $files) {
    $count++
    if (($count % 50) -eq 0) {
      Write-Host ("Processed {0}/{1}" -f $count, $files.Count)
    }
    $opened = $null
    try {
      $opened = Open-ReadOnlyDocument $word $entry.File $tempRoot
      $lines = Normalize-Lines $opened.Document.Content.Text
      $hits = @()
      for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '二氧化硫') { $hits += $i }
      }
      if ($hits.Count) {
        $sections = foreach ($i in $hits) {
          $start = [Math]::Max(0, $i - 8)
          $end = [Math]::Min($lines.Count - 1, $i + 100)
          [pscustomobject]@{
            hit = $lines[$i]
            context = @($lines[$start..$end])
          }
        }
        $records.Add([pscustomobject]@{
          kind = $entry.Kind
          file = $entry.File.Name
          fullPath = $entry.File.FullName
          modified = $entry.File.LastWriteTime.ToString('s')
          sections = @($sections)
        })
      }
    } catch {
      $errors.Add([pscustomobject]@{
        file = $entry.File.FullName
        error = $_.Exception.Message
      })
    } finally {
      if ($opened -and $opened.Document) {
        try { $opened.Document.Close($false) } catch {}
      }
      if ($opened -and $opened.TempPath -and (Test-Path -LiteralPath $opened.TempPath)) {
        Remove-Item -LiteralPath $opened.TempPath -Force
      }
    }

    if (($count % 100) -eq 0) {
      try { $word.Quit() } catch {}
      try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
      $word = New-WordApplication
    }
  }
} finally {
  try { $word.Quit() } catch {}
  try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
}

[pscustomobject]@{
  generatedAt = (Get-Date).ToString('s')
  records = $records
  errors = $errors
} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $OutputPath -Encoding UTF8

Write-Host ("Extracted {0} sulfur-dioxide records; {1} document errors" -f $records.Count, $errors.Count)
Write-Host $OutputPath
