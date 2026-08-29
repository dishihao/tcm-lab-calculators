param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [string]$RecordsBase = '',
  [string]$PopplerPath = 'C:\Users\37475\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe'
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$Manifest = [IO.Path]::GetFullPath((Join-Path $workspaceRoot $Manifest))
$OutputDir = [IO.Path]::GetFullPath((Join-Path $workspaceRoot $OutputDir))
if (-not $RecordsBase) {
  $gitCommon = (& git -C $workspaceRoot rev-parse --path-format=absolute --git-common-dir).Trim()
  $RecordsBase = Split-Path -Parent (Split-Path -Parent $gitCommon)
}
$RecordsBase = [IO.Path]::GetFullPath($RecordsBase)
if (-not (Test-Path -LiteralPath $PopplerPath)) { throw "pdftoppm not found: $PopplerPath" }
$manifestData = Get-Content -Raw -LiteralPath $Manifest | ConvertFrom-Json
if (@($manifestData.entries).Count -ne 33) { throw 'manifest must contain exactly 33 template entries' }
$run = Join-Path $OutputDir ('visual-qa-{0}' -f [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $run | Out-Null

function Release-Com([object]$value) { if ($null -ne $value) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($value) } catch {} } }
function Copy-PageSetup($source, $target) {
  foreach ($property in 'PageWidth','PageHeight','TopMargin','BottomMargin','LeftMargin','RightMargin','Gutter','HeaderDistance','FooterDistance') {
    $target.PageSetup.$property = $source.PageSetup.$property
  }
}
function Open-SourceReadOnly($word, $sourcePath) {
  try { return @{ Document = $word.Documents.Open($sourcePath, $false, $true, $false); TempPath = $null } }
  catch {
    # Some historical records are OLE .doc payloads with a .docx suffix.  Word
    # rejects their declared extension, so open a disposable .doc copy only.
    $copy = Join-Path $env:TEMP ("tcm-gc-word-source-{0}.doc" -f [guid]::NewGuid().ToString('N'))
    Copy-Item -LiteralPath $sourcePath -Destination $copy
    try { return @{ Document = $word.Documents.Open($copy, $false, $true, $false); TempPath = $copy } }
    catch { if (Test-Path -LiteralPath $copy) { Remove-Item -LiteralPath $copy -Force }; throw }
  }
}
function Export-Table($word, $sourcePath, [int]$tableIndex, $role, $targetDir) {
  $source = $null; $opened = $null; $sourceTable = $null; $temporary = $null
  $stage = 'hash-source'
  $token = [guid]::NewGuid().ToString('N'); $tempDoc = Join-Path $env:TEMP "tcm-gc-word-export-$token.docx"; $tempPdf = Join-Path $env:TEMP "tcm-gc-word-export-$token.pdf"; $ppmBase = Join-Path $env:TEMP "tcm-gc-word-export-$token"
  try {
    $beforeHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
    $stage = 'open-source'
    $opened = Open-SourceReadOnly $word $sourcePath
    $source = $opened.Document
    $stage = 'create-temporary-document'
    $temporary = $word.Documents.Add()
    $stage = 'copy-page-setup'
    Copy-PageSetup $source $temporary
    $stage = 'read-source-table'
    $sourceTable = $source.Tables.Item($tableIndex)
    $stage = 'copy-formatted-table-range'
    $temporary.Content.FormattedText = $sourceTable.Range.FormattedText
    $stage = 'restore-table-indent'
    $copiedTable = $temporary.Tables.Item(1)
    $sourceIndent = [double]$sourceTable.Rows.LeftIndent
    # A Word mixed-row sentinel is outside the legal PageSetup range.  The
    # formatted range already copied its per-row indentation; only assign a
    # concrete table-level indent when Word reports one.
    if ($sourceIndent -ge -1584 -and $sourceIndent -le 1584) { $copiedTable.Rows.LeftIndent = $sourceIndent }
    $stage = 'save-temporary-document'
    $temporary.SaveAs2($tempDoc, 16)
    $stage = 'export-temporary-pdf'
    $temporary.ExportAsFixedFormat($tempPdf, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1, $true, $false, $false)
    $stage = 'render-pdf-with-poppler'
    & $PopplerPath -png -r 144 -singlefile $tempPdf $ppmBase
    if ($LASTEXITCODE -ne 0) { throw "pdftoppm failed for $sourcePath table $tableIndex" }
    $png = "$ppmBase.png"; if (-not (Test-Path -LiteralPath $png)) { throw "pdftoppm did not make $png" }
    $stage = 'copy-rendered-png'
    Copy-Item -LiteralPath $png -Destination (Join-Path $targetDir "$role-word.png")
    @{ dpi = 144; sourceFile = $sourcePath; sourceTableIndex = $tableIndex; sourceSha256Before = $beforeHash; sourceSha256After = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash; pageWidthPt = [double]$source.PageSetup.PageWidth; tableIndentPt = [double]$sourceTable.Rows.LeftIndent } | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath (Join-Path $targetDir "$role-word.json")
    $stage = 'verify-source-hash'
    if ($beforeHash -ne (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash) { throw "SOURCE MUTATED: $sourcePath" }
  } catch {
    throw ("Export stage {0}: {1}" -f $stage, $_.Exception.Message)
  } finally {
    if ($temporary) { try { $temporary.Close($false) } catch {}; Release-Com $temporary }
    if ($sourceTable) { Release-Com $sourceTable }
    if ($source) { try { $source.Close($false) } catch {}; Release-Com $source }
    if ($opened -and $opened.TempPath -and (Test-Path -LiteralPath $opened.TempPath)) { Remove-Item -LiteralPath $opened.TempPath -Force }
    foreach ($path in @($tempDoc, $tempPdf, "$ppmBase.png")) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
  }
}

$word = $null; $errors = [Collections.Generic.List[object]]::new()
try {
  $word = New-Object -ComObject Word.Application; $word.Visible = $false; $word.DisplayAlerts = 0
  foreach ($entry in @($manifestData.entries)) {
    $target = Join-Path $run $entry.templateId; New-Item -ItemType Directory -Force -Path $target | Out-Null
    $source = Join-Path (Join-Path $RecordsBase $entry.root) $entry.sourceFile
    try {
      Export-Table $word $source ([int]$entry.referenceTableIndex) 'reference' $target
      Export-Table $word $source ([int]$entry.sampleTableIndex) 'sample' $target
    } catch { $errors.Add(@{ templateId = $entry.templateId; error = $_.Exception.Message }) }
  }
} finally { if ($word) { try { $word.Quit() } catch {}; Release-Com $word }; [GC]::Collect(); [GC]::WaitForPendingFinalizers() }
$report = @{ run = $run; templateCount = @($manifestData.entries).Count; tableCount = 66; errors = @($errors); sourceReadOnly = $true; tempFilesCleaned = $true }
$report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $run 'word-export-summary.json')
Write-Host ("Exported {0}/66 Word tables to {1}; errors={2}" -f (66 - ($errors.Count * 2)), $run, $errors.Count)
if ($errors.Count) { $errors | ConvertTo-Json -Depth 6; exit 1 }
