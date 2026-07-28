param(
  [string]$WorkspaceRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$OutputPath = (Join-Path $PSScriptRoot 'quality-template-extract.json')
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

function Find-Item($lines, [string]$itemId, [string]$headingPattern) {
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -notmatch $headingPattern) { continue }

    $end = [Math]::Min($lines.Count - 1, $i + 90)
    $method = ''
    $standard = ''
    for ($j = $i + 1; $j -le $end; $j++) {
      $line = $lines[$j]
      if (-not $method -and $line -match '(测定法|检查法).*(通则|测定|检查)') {
        $method = $line
      }
      if ($line -match '标准规定.*(不得|不应|不少于|应不|限度)') {
        $standard = $line
        break
      }
      if ($j -gt ($i + 3) -and $line -match '^(【检查】)?(杂质|水分|总灰分|酸不溶性灰分|水溶性浸出物|醇溶性浸出物|浸出物|含量测定)(】|\s|$)') {
        break
      }
    }
    if ($standard) {
      return [pscustomobject]@{
        item = $itemId
        heading = $lines[$i]
        method = $method
        standard = $standard
      }
    }
  }
  return $null
}

$results = [System.Collections.Generic.List[object]]::new()
$errors = [System.Collections.Generic.List[object]]::new()

function New-WordApplication {
  $app = New-Object -ComObject Word.Application
  $app.Visible = $false
  $app.DisplayAlerts = 0
  return $app
}

function Save-Results {
  [pscustomobject]@{
    generatedAt = (Get-Date).ToString('s')
    records = $results
    errors = $errors
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}

$word = New-WordApplication
try {
  $files = foreach ($root in $roots) {
    Get-ChildItem -LiteralPath $root.Path -File -Recurse |
      Where-Object { $_.Extension -in '.doc', '.docx' } |
      ForEach-Object {
        [pscustomobject]@{ File = $_; Kind = $root.Kind }
      }
  }

  $count = 0
  foreach ($entry in $files) {
    $count++
    if (($count % 50) -eq 0) {
      Write-Host ("Processed {0}/{1}" -f $count, $files.Count)
    }
    $doc = $null
    try {
      $doc = $word.Documents.Open($entry.File.FullName, $false, $true, $false)
      $lines = Normalize-Lines $doc.Content.Text
      $items = @(
        Find-Item $lines 'impurity' '^(【检查】)?杂质(】|\s|$)'
        Find-Item $lines 'moisture' '^水分(\s|$|1\.)'
        Find-Item $lines 'ash' '^总灰分(\s|$|1\.)'
        Find-Item $lines 'extract' '^【?(水溶性|醇溶性)?浸出物】?'
      ) | Where-Object { $_ }

      foreach ($item in $items) {
        $results.Add([pscustomobject]@{
          kind = $entry.Kind
          file = $entry.File.Name
          fullPath = $entry.File.FullName
          modified = $entry.File.LastWriteTime.ToString('s')
          item = $item.item
          heading = $item.heading
          method = $item.method
          standard = $item.standard
        })
      }
    } catch {
      $errors.Add([pscustomobject]@{
        file = $entry.File.FullName
        error = $_.Exception.Message
      })
    } finally {
      if ($doc) {
        try { $doc.Close($false) } catch {}
      }
    }

    if (($count % 100) -eq 0) {
      Save-Results
      try { $word.Quit() } catch {}
      try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
      $word = New-WordApplication
    }
  }
} finally {
  try { $word.Quit() } catch {}
  try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
  Save-Results
}

Write-Host ("Extracted {0} item records; {1} document errors" -f $results.Count, $errors.Count)
Write-Host $OutputPath



