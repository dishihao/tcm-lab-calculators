$ErrorActionPreference = 'Stop'

$extractorPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\extract_gc_word_tables.ps1'
$tokens = $null
$parseErrors = $null
$extractorAst = [Management.Automation.Language.Parser]::ParseFile(
  $extractorPath,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count) {
  throw "Extractor parse failed: $($parseErrors[0].Message)"
}

$functionDefinitions = @(
  $extractorAst.FindAll(
    { param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] },
    $true
  ) | ForEach-Object { $_.Extent.Text }
)
Invoke-Expression ($functionDefinitions -join "`n`n")

$script:wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
$script:mNs = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
$failures = [Collections.Generic.List[string]]::new()

function Assert-Equal {
  param([string]$Name, $Actual, $Expected)
  if ($Actual -ne $Expected) {
    $failures.Add("${Name}: expected '$Expected', got '$Actual'")
  }
}

function New-NamespaceManager {
  param([xml]$Document)
  $manager = [Xml.XmlNamespaceManager]::new($Document.NameTable)
  $manager.AddNamespace('w', $script:wNs)
  $manager.AddNamespace('m', $script:mNs)
  Write-Output -NoEnumerate $manager
}

[xml]$paragraphDocument = @'
<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
     xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:r><w:t>A</w:t></w:r>
  <m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>
  <w:r><w:t>B</w:t></w:r>
</w:p>
'@
$paragraph = Convert-Paragraph $paragraphDocument.DocumentElement (New-NamespaceManager $paragraphDocument) 1
$paragraphOrder = @($paragraph.runs | ForEach-Object { "$($_.kind):$($_.text)" }) -join '|'
Assert-Equal 'paragraph run order' $paragraphOrder 'text:A|math:x|text:B'
Assert-Equal 'paragraph text order' $paragraph.text 'AxB'
$paragraphMathRun = @($paragraph.runs | Where-Object { $_.kind -eq 'math' })[0]
Assert-Equal 'paragraph math OOXML retained' ([bool]$paragraphMathRun.mathOoxml) $true

[xml]$cellDocument = @'
<w:tc xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
      xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:tcPr/>
  <w:p><w:r><w:t>A</w:t></w:r></w:p>
  <m:oMathPara><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></m:oMathPara>
  <w:p><w:r><w:t>B</w:t></w:r></w:p>
</w:tc>
'@
$cell = Convert-Cell $cellDocument.DocumentElement (New-NamespaceManager $cellDocument) 1 1 1
$cellOrder = @($cell.paragraphs | ForEach-Object {
  $kind = if ($_.runs.Count -eq 1) { $_.runs[0].kind } else { 'mixed' }
  "${kind}:$($_.text)"
}) -join '|'
Assert-Equal 'cell content order' $cellOrder 'text:A|math:x|text:B'
Assert-Equal 'cell text order' $cell.text "A`nx`nB"
$cellMathRun = @($cell.paragraphs.runs | Where-Object { $_.kind -eq 'math' })[0]
Assert-Equal 'cell math OOXML retained' ([bool]$cellMathRun.mathOoxml) $true

if ($failures.Count) {
  throw "Synthetic OOXML order regression:`n$($failures -join "`n")"
}

Write-Host 'PASS: synthetic OOXML preserves text-math-text order in paragraphs and cells'
