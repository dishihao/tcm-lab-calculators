param(
  [string]$InventoryPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'output/record-table-inventory'),
  [string]$SourceId = '',
  [int]$Shard = 0,
  [int]$ShardCount = 1
)
$ErrorActionPreference = 'Stop'
# Reuse the audited, pure XML converters. Loading only function ASTs prevents
# Word COM startup, manifest reads and source-file mutation in the GC extractor.
$tokens = $null; $parseErrors = $null
$extractor = Join-Path $PSScriptRoot 'extract_gc_word_tables.ps1'
$converterHash=(Get-FileHash -LiteralPath $extractor -Algorithm SHA256).Hash
$parserHash=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
$ast = [Management.Automation.Language.Parser]::ParseFile($extractor, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Cannot parse audited Word conversion helpers' }
foreach ($function in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)) {
  if ($function.Name -in @('Convert-TableCapture','Get-TableCapture','New-WordApplication')) { continue }
  . ([scriptblock]::Create($function.Extent.Text))
}
$script:wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
$script:mNs = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
$script:pkgNs = 'http://schemas.microsoft.com/office/2006/xmlPackage'
$parsedPath = Join-Path $InventoryPath 'parsed'
[void][IO.Directory]::CreateDirectory($parsedPath)
$sources = if ($SourceId) { @(Get-Item -LiteralPath (Join-Path $InventoryPath "$SourceId.json")) } else {
  @(Get-ChildItem -LiteralPath $InventoryPath -Filter '*.json' | Where-Object { Test-Path -LiteralPath (Join-Path $InventoryPath ($_.BaseName + '.xml')) })
}
foreach ($sourceFile in $sources) {
  if ($ShardCount -gt 1 -and ([Convert]::ToInt32($sourceFile.BaseName.Substring(0,4),16) % $ShardCount) -ne $Shard) { continue }
  $outputPath = Join-Path $parsedPath $sourceFile.Name
  $source = Get-Content -Raw -LiteralPath $sourceFile.FullName | ConvertFrom-Json
  if ($source.status -ne 'ok') { continue }
  if (Test-Path -LiteralPath $outputPath) {
    $cached=Get-Content -Raw -LiteralPath $outputPath | ConvertFrom-Json
    if($cached.schemaVersion -eq 2 -and $cached.sourceSha256 -eq $source.sha256Before -and $cached.converterHash -eq $converterHash -and $cached.parserHash -eq $parserHash){continue}
  }
  [xml]$xml = Get-Content -Raw -LiteralPath (Join-Path $InventoryPath ($sourceFile.BaseName + '.xml'))
  $ns = [Xml.XmlNamespaceManager]::new($xml.NameTable)
  $ns.AddNamespace('pkg',$script:pkgNs); $ns.AddNamespace('w',$script:wNs); $ns.AddNamespace('m',$script:mNs)
  $tableNodes = @($xml.SelectNodes("/pkg:package/pkg:part[@pkg:name='/word/document.xml']/pkg:xmlData/w:document/w:body//w:tbl[not(ancestor::w:tbl)]",$ns))
  if ($tableNodes.Count -ne @($source.tables).Count) { throw "Source $($source.id): table inventory cardinality mismatch" }
  $tables = [Collections.Generic.List[object]]::new()
  for ($index = 0; $index -lt $tableNodes.Count; $index++) {
    $table = $tableNodes[$index]
    try {
      if ($table.SelectNodes('.//w:tbl',$ns).Count) { throw 'nested tables require explicit review' }
      $props = $table.SelectSingleNode('w:tblPr',$ns)
      $grid = @($table.SelectNodes('w:tblGrid/w:gridCol',$ns) | ForEach-Object { Convert-TwipsToPoints (Get-NamespacedAttribute $_ 'w') })
      if (-not $grid.Count) { throw 'missing source grid' }
      $margins = Convert-Margins ($props.SelectSingleNode('w:tblCellMar',$ns)) $ns
      $rows = [Collections.Generic.List[object]]::new(); $cells = [Collections.Generic.List[object]]::new()
      foreach ($row in $table.SelectNodes('w:tr',$ns)) {
        $rp = $row.SelectSingleNode('w:trPr',$ns)
        # XML can omit property elements; synthetic empty nodes are local only.
        if (-not $rp) { $rp = $xml.CreateElement('w','trPr',$script:wNs) }
        $height = $rp.SelectSingleNode('w:trHeight',$ns)
        $before = Get-NamespacedAttribute ($rp.SelectSingleNode('w:gridBefore',$ns)) 'val'
        $column = 1 + [int]$before; $cellNumber = 0
        foreach ($cell in $row.SelectNodes('w:tc',$ns)) {
          if (-not $cell.SelectSingleNode('w:tcPr',$ns)) { [void]$cell.PrependChild($xml.CreateElement('w','tcPr',$script:wNs)) }
          $cellNumber++
          $converted = Convert-Cell $cell $ns ($rows.Count + 1) $cellNumber $column ([pscustomobject]@{
            templateId=$source.id;tableRole="table$($index + 1)";sourceTableIndex=$index + 1
          })
          $cells.Add($converted); $column += $converted.gridSpan
        }
        $rows.Add([pscustomobject]@{
          rowIndex=$rows.Count+1; heightPt=(Convert-TwipsToPoints (Get-NamespacedAttribute $height 'val'))
          heightRule=(Get-NamespacedAttribute $height 'hRule'); gridBefore=[int]$before
          gridAfter=[int](Get-NamespacedAttribute ($rp.SelectSingleNode('w:gridAfter',$ns)) 'val')
          cantSplit=(Convert-OnOff ($rp.SelectSingleNode('w:cantSplit',$ns)))
          repeatHeader=(Convert-OnOff ($rp.SelectSingleNode('w:tblHeader',$ns)))
        })
      }
      $tables.Add([pscustomobject]@{
        sourceTableIndex=$index+1; status='ok'; role="table$($index+1)"; gridPt=$grid
        widthPt=($grid | Measure-Object -Sum).Sum
        indentPt=(Convert-TwipsToPoints (Get-NamespacedAttribute ($props.SelectSingleNode('w:tblInd',$ns)) 'w'))
        topPaddingPt=$margins.top.valuePt; bottomPaddingPt=$margins.bottom.valuePt; leftPaddingPt=$margins.left.valuePt; rightPaddingPt=$margins.right.valuePt
        tableProperties=[pscustomobject]@{
          styleId=(Get-NamespacedAttribute ($props.SelectSingleNode('w:tblStyle',$ns)) 'val')
          borders=(Convert-Borders ($props.SelectSingleNode('w:tblBorders',$ns)) $ns)
          cellMargins=$margins
          width=(Convert-WidthNode ($props.SelectSingleNode('w:tblW',$ns)))
          alignment=(Get-NamespacedAttribute ($props.SelectSingleNode('w:jc',$ns)) 'val')
        }
        rows=@($rows);cells=@($cells);sourceOoxmlHash=(Get-Sha256Hex $table.OuterXml)
      })
    } catch {
      $tables.Add([pscustomobject]@{sourceTableIndex=$index+1;status='unresolved';reason=$_.Exception.Message})
    }
  }
  [pscustomobject]@{schemaVersion=2;id=$source.id;kind=$source.kind;sourceFile=$source.sourceFile;sourceSha256=$source.sha256Before;converterHash=$converterHash;parserHash=$parserHash;tables=@($tables)} |
    ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $outputPath -Encoding utf8
  Write-Output "PARSED $($source.id): $($tables.Count) tables"
}
