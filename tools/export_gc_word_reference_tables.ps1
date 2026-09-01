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
if (-not $RecordsBase) { $gitCommon = (& git -C $workspaceRoot rev-parse --path-format=absolute --git-common-dir).Trim(); $RecordsBase = Split-Path -Parent (Split-Path -Parent $gitCommon) }
$RecordsBase = [IO.Path]::GetFullPath($RecordsBase)
if (-not (Test-Path -LiteralPath $PopplerPath)) { throw "pdftoppm not found: $PopplerPath" }
$manifestData = Get-Content -Raw -LiteralPath $Manifest | ConvertFrom-Json
. (Join-Path $workspaceRoot 'tools\gc_word_open_recovery.ps1')
if (@($manifestData.entries).Count -ne 33) { throw 'manifest must contain exactly 33 template entries' }
$extract = Get-Content -Raw -LiteralPath (Join-Path $workspaceRoot 'tools\gc-word-table-extract.json') | ConvertFrom-Json
$structureByKey = @{}; foreach ($template in @($extract.templates)) { $structureByKey["$($template.templateId)|reference"] = $template.referenceTable; $structureByKey["$($template.templateId)|sample"] = $template.sampleTable }
$embeddedRegistry = Get-Content -Raw -LiteralPath (Join-Path $workspaceRoot 'tools\gc-word-embedded-object-semantics.json') | ConvertFrom-Json
$semanticByTarget = @{}
$semanticText = @{
  externalReferenceAverage = 'text("对照品平均峰面积")|overline(text("A"))|subscript(text("对"))'
  externalSampleAverage = 'text("样品平均峰面积")|overline(text("A"))'
  sampleMean = 'text("平均含量")|overline(text("X"))|text("（%）")'
  internalCorrectionFactor = 'text("校正因子f＝")|fraction(text("A")|subscript(text("S"))|text("／C")|subscript(text("S")),text("A")|subscript(text("R"))|text("／C")|subscript(text("R")))'
}
foreach ($item in @($embeddedRegistry.entries)) {
  $parts = ([string]$item.identity).Split('|')
  $semanticByTarget["$($parts[0])|$($parts[1])|$($item.targetCellId)"] = $semanticText[[string]$item.semanticType]
}
$run = Join-Path $OutputDir ('visual-qa-{0}' -f [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')); New-Item -ItemType Directory -Force -Path $run | Out-Null
Add-Type -AssemblyName System.Drawing

function Release-Com([object]$value) { if ($null -ne $value) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($value) } catch {} } }
function Copy-PageSetup($source, $target) { foreach ($property in 'PageWidth','PageHeight','TopMargin','BottomMargin','LeftMargin','RightMargin','Gutter','HeaderDistance','FooterDistance') { $target.PageSetup.$property = $source.PageSetup.$property } }
function Get-WordCellTextLineCount($wordTable, $cellMetric) {
  $cell = $null; $range = $null
  try {
    $cell = $wordTable.Rows.Item([int]$cellMetric.rowIndex).Cells.Item([int]$cellMetric.cellIndex)
    $end = $cell.Range.End - 1 # exclude Word's end-of-cell marker
    $range = $cell.Range.Duplicate; $range.End = $end
    $text = ($range.Text -replace "[`r`n`a`t]", '').Trim()
    if ([string]::IsNullOrWhiteSpace($text)) { return 0 }
    return [int]$range.ComputeStatistics(1) # wdStatisticLines
  } finally { if ($range) { Release-Com $range }; if ($cell) { Release-Com $cell } }
}
function Select-SourceStructure($table, $wordTable, [string]$templateId, [string]$role) {
  [pscustomobject]@{ sourceTableIndex = $table.sourceTableIndex; widthPt = $table.widthPt; indentPt = $table.indentPt; gridPt = @($table.gridPt); rows = @($table.rows | ForEach-Object { [pscustomobject]@{ rowIndex = $_.rowIndex; heightPt = $_.heightPt; heightRule = $_.heightRule } }); cells = @($table.cells | ForEach-Object { $cellId = "${role}-r$($_.rowIndex)c$($_.gridColumnIndex)"; [pscustomobject]@{ rowIndex = $_.rowIndex; cellIndex = $_.cellIndex; gridColumnIndex = $_.gridColumnIndex; gridSpan = $_.gridSpan; verticalMerge = $_.verticalMerge; borders = $_.borders; text = $_.text; renderedSemanticExpected = $semanticByTarget["${templateId}|${role}|${cellId}"]; paragraphCount = @($_.paragraphs).Count; textLineCount = (Get-WordCellTextLineCount $wordTable $_) } }) }
}
function Assert-OnlyIntendedTable($document, $table) {
  # FormattedText can include a following formula or secondary table.  The first
  # copied table is the only authorized object; remove everything after it first.
  $before = $document.Range(0, $table.Range.Start).Text
  $tail = $document.Range($table.Range.End, $document.Content.End)
  if ($tail.End -gt $tail.Start) { [void]$tail.Delete() }
  # A copied range can carry a following formula table. Remove every non-first
  # table object explicitly, in reverse order, before asserting the boundary.
  for ($index = $document.Tables.Count; $index -ge 2; $index--) {
    $extra = $document.Tables.Item($index)
    try { [void]$extra.Delete() } finally { Release-Com $extra }
  }
  if ($document.Tables.Count -ne 1) { throw "temporary document has $($document.Tables.Count) tables after tail removal, expected exactly 1" }
  $intended = $document.Tables.Item(1)
  $after = $document.Range($intended.Range.End, $document.Content.End).Text
  # Word must retain one terminal paragraph mark; any other visible content is a leak.
  $visible = (($before + $after) -replace "[`r`n`a`t]", '')
  $visibleOutsideTable = -not [string]::IsNullOrWhiteSpace($visible)
  if ($visibleOutsideTable) { throw 'temporary document contains visible non-table content outside the intended outer border' }
  return [pscustomobject]@{ table = $intended; exactOneTable = ($document.Tables.Count -eq 1); visibleOutsideTable = $visibleOutsideTable; nonTableTextOutsideTable = $visibleOutsideTable; visibleOutsideTextLength = $visible.Length }
}
function Crop-VisibleTablePng([string]$sourcePng, [string]$destinationPng) {
  $bitmap = [Drawing.Bitmap]::new($sourcePng); $crop = $null
  try {
    $minX = $bitmap.Width; $minY = $bitmap.Height; $maxX = -1; $maxY = -1
    for ($y = 0; $y -lt $bitmap.Height; $y++) { for ($x = 0; $x -lt $bitmap.Width; $x++) { $pixel = $bitmap.GetPixel($x, $y); if ($pixel.R -lt 235 -or $pixel.G -lt 235 -or $pixel.B -lt 235) { if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }; if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y } } } }
    if ($maxX -lt $minX -or $maxY -lt $minY) { throw 'PDF render contains no visible table ink' }
    $rect = [Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1); $crop = $bitmap.Clone($rect, $bitmap.PixelFormat); $crop.SetResolution(144, 144); $crop.Save($destinationPng, [Drawing.Imaging.ImageFormat]::Png)
    return [pscustomobject]@{ originPx144 = @{ x = $rect.X; y = $rect.Y }; cropPx144 = @{ width = $rect.Width; height = $rect.Height }; cropCssPx = @{ width = [Math]::Round($rect.Width * 2 / 3, 3); height = [Math]::Round($rect.Height * 2 / 3, 3) }; fullPagePx144 = @{ width = $bitmap.Width; height = $bitmap.Height } }
  } finally { if ($crop) { $crop.Dispose() }; $bitmap.Dispose() }
}
function Export-Table($word, $sourcePath, [int]$tableIndex, $role, $targetDir, $sourceStructure, $recovery, [string]$templateId) {
  $source = $null; $opened = $null; $sourceTable = $null; $temporary = $null; $copiedTable = $null; $stage = 'hash-source'; $token = [guid]::NewGuid().ToString('N'); $tempDoc = Join-Path $env:TEMP "tcm-gc-word-export-$token.docx"; $tempPdf = Join-Path $env:TEMP "tcm-gc-word-export-$token.pdf"; $ppmBase = Join-Path $env:TEMP "tcm-gc-word-export-$token"
  try {
    $beforeHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash; $stage = 'open-source'; $opened = Open-GcWordDocumentReadOnly -SourcePath $sourcePath -Recovery $recovery -Word $word; $source = $opened.Document; $stage = 'create-temporary-document'; $temporary = $word.Documents.Add(); Copy-PageSetup $source $temporary
    $stage = 'read-source-table'; $sourceTable = $source.Tables.Item($tableIndex); $stage = 'copy-formatted-table-range'; $temporary.Content.FormattedText = $sourceTable.Range.FormattedText; $stage = 'assert-only-intended-table'; $copiedTable = $temporary.Tables.Item(1); $boundary = Assert-OnlyIntendedTable $temporary $copiedTable; $copiedTable = $boundary.table
    $stage = 'restore-table-indent'; $sourceIndent = [double]$sourceTable.Rows.LeftIndent; if ($sourceIndent -ge -1584 -and $sourceIndent -le 1584) { $copiedTable.Rows.LeftIndent = $sourceIndent }; $stage = 'save-temporary-document'; $temporary.SaveAs2($tempDoc, 16); $stage = 'export-temporary-pdf'; $temporary.ExportAsFixedFormat($tempPdf, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1, $true, $false, $false)
    $stage = 'render-pdf-with-poppler'; & $PopplerPath -png -r 144 -singlefile $tempPdf $ppmBase; if ($LASTEXITCODE -ne 0) { throw "pdftoppm failed for source table $tableIndex" }; $png = "$ppmBase.png"; if (-not (Test-Path -LiteralPath $png)) { throw "pdftoppm did not make $png" }; $stage = 'crop-exact-table-ink'; $crop = Crop-VisibleTablePng $png (Join-Path $targetDir "$role-word.png")
    $stage = 'verify-source-hash'; $afterHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash; if ($beforeHash -ne $afterHash) { throw "SOURCE MUTATED: $sourcePath" }; $meta = [pscustomobject]@{ dpi = 144; sourceFile = $sourcePath; sourceTableIndex = $tableIndex; sourceSha256Before = $beforeHash; sourceSha256After = $afterHash; sourceReadOnly = $true; usedTempRecovery = $opened.usedTempRecovery; recoveryReason = $opened.recoveryReason; temporarySuffix = $opened.temporarySuffix; boundaryAssertions = [pscustomobject]@{ exactOneTable = $boundary.exactOneTable; visibleOutsideTable = $boundary.visibleOutsideTable; nonTableTextOutsideTable = $boundary.nonTableTextOutsideTable; visibleOutsideTextLength = $boundary.visibleOutsideTextLength }; pageWidthPt = [double]$source.PageSetup.PageWidth; pageLeftMarginPt = [double]$source.PageSetup.LeftMargin; tableIndentPt = $sourceStructure.indentPt; crop = $crop; sourceStructure = (Select-SourceStructure $sourceStructure $sourceTable $templateId $role) }; $meta | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $targetDir "$role-word.json"); return $meta
  } catch { throw ("Export stage {0}: {1}" -f $stage, $_.Exception.Message) }
  finally { if ($copiedTable) { Release-Com $copiedTable }; if ($temporary) { try { $temporary.Close($false) } catch {}; Release-Com $temporary }; if ($sourceTable) { Release-Com $sourceTable }; if ($source) { try { $source.Close($false) } catch {}; Release-Com $source }; if ($opened -and $opened.TempPath -and (Test-Path -LiteralPath $opened.TempPath)) { Remove-Item -LiteralPath $opened.TempPath -Force }; foreach ($path in @($tempDoc, $tempPdf, "$ppmBase.png")) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } } }
}

$word = $null; $errors = [Collections.Generic.List[object]]::new(); $successes = [Collections.Generic.List[object]]::new()
try { $word = New-Object -ComObject Word.Application; $word.Visible = $false; $word.DisplayAlerts = 0
  foreach ($entry in @($manifestData.entries)) { $target = Join-Path $run $entry.templateId; New-Item -ItemType Directory -Force -Path $target | Out-Null; $source = Join-Path (Join-Path $RecordsBase $entry.root) $entry.sourceFile
    foreach ($role in @(@{ name = 'reference'; index = [int]$entry.referenceTableIndex }, @{ name = 'sample'; index = [int]$entry.sampleTableIndex })) { try { $meta = Export-Table $word $source $role.index $role.name $target $structureByKey["$($entry.templateId)|$($role.name)"] $entry.tempRecovery $entry.templateId; $successes.Add(@{ templateId = $entry.templateId; role = $role.name; sourceTableIndex = $role.index; cropCssPx = $meta.crop.cropCssPx; usedTempRecovery = $meta.usedTempRecovery; recoveryReason = $meta.recoveryReason; temporarySuffix = $meta.temporarySuffix }) } catch { $errors.Add(@{ templateId = $entry.templateId; role = $role.name; sourceTableIndex = $role.index; error = $_.Exception.Message }) } }
  }
} finally { if ($word) { try { $word.Quit() } catch {}; Release-Com $word }; [GC]::Collect(); [GC]::WaitForPendingFinalizers() }
$report = @{ run = $run; templateCount = @($manifestData.entries).Count; tableCount = 66; successfulTables = @($successes).Count; failedTables = @($errors).Count; successes = @($successes); errors = @($errors); sourceReadOnly = $true; tempFilesCleaned = $true }; $report | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $run 'word-export-summary.json'); Write-Host ("Exported {0}/66 Word tables to {1}; errors={2}" -f $successes.Count, $run, $errors.Count); if ($errors.Count) { $errors | ConvertTo-Json -Depth 10; exit 1 }
