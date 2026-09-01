$ErrorActionPreference = 'Stop'

$extractorPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\extract_gc_word_tables.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($extractorPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw $parseErrors[0].Message }
$definitions = @($ast.FindAll(
  { param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $true
) | ForEach-Object { $_.Extent.Text })
Invoke-Expression ($definitions -join "`n`n")

$script:wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
$script:pkgNs = 'http://schemas.microsoft.com/office/2006/xmlPackage'

function New-ObjectPackage([string]$RelationshipId, [string]$BinaryData, [string]$Width = '259') {
  [xml]@"
<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document><w:body><w:tbl><w:tr><w:tc><w:p><w:r>
  <w:object w:dxaOrig="$Width" w:dyaOrig="319"><o:OLEObject Type="Embed" ProgID="Equation.3" ObjectID="_volatile" r:id="$RelationshipId"/></w:object>
 </w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document></pkg:xmlData></pkg:part>
 <pkg:part pkg:name="/word/_rels/document.xml.rels"><pkg:xmlData>
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
   <Relationship Id="$RelationshipId" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.bin"/>
  </Relationships>
 </pkg:xmlData></pkg:part>
 <pkg:part pkg:name="/word/embeddings/oleObject1.bin"><pkg:binaryData>$BinaryData</pkg:binaryData></pkg:part>
</pkg:package>
"@
}

function Get-FixtureEvidence([xml]$Package, [string]$CellId = 'reference-r5c1', [string]$TemplateId = 'fixture-template', [string]$Role = 'reference', [int]$TableIndex = 7) {
  $ns = [Xml.XmlNamespaceManager]::new($Package.NameTable)
  $ns.AddNamespace('pkg', $script:pkgNs); $ns.AddNamespace('w', $script:wNs)
  $container = $Package.SelectSingleNode("/pkg:package/pkg:part[@pkg:name='/word/document.xml']/pkg:xmlData/w:document/w:body/w:tbl/w:tr/w:tc/w:p/w:r/w:object", $ns)
  $sourceIdentity = "${TemplateId}|${Role}|${TableIndex}|${CellId}|object1"
  Get-SourceObjectEvidence -ContainerNode $container -PackageDocument $Package -NamespaceManager $ns `
    -SourceIdentity $sourceIdentity -TemplateId $TemplateId -TableRole $Role -SourceTableIndex $TableIndex `
    -SourceCellId $CellId -ContainerCategory 'embedded-equation'
}

function Get-LineEvidence([string]$LineId, [string]$From = '102.75pt,2.3pt', [string]$To = '108pt,2.35pt') {
  [xml]$package = @"
<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:v="urn:schemas-microsoft-com:vml">
 <pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document><w:body><w:tbl><w:tr><w:tc><w:p><w:r>
  <w:pict><v:line id="$LineId" from="$From" to="$To" style="position:absolute;left:0"/></w:pict>
 </w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document></pkg:xmlData></pkg:part>
 <pkg:part pkg:name="/word/_rels/document.xml.rels"><pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/></pkg:xmlData></pkg:part>
</pkg:package>
"@
  $ns = [Xml.XmlNamespaceManager]::new($package.NameTable)
  $ns.AddNamespace('pkg', $script:pkgNs); $ns.AddNamespace('w', $script:wNs)
  $container = $package.SelectSingleNode("/pkg:package/pkg:part[@pkg:name='/word/document.xml']/pkg:xmlData/w:document/w:body/w:tbl/w:tr/w:tc/w:p/w:r/w:pict", $ns)
  Get-SourceObjectEvidence $container $package $ns 'line-template|sample|8|sample-r7c1|object1' `
    'line-template' 'sample' 8 'sample-r7c1' 'floating-overline'
}

function Expect-Rejection([string]$Name, [scriptblock]$Action, [string]$Pattern) {
  try { & $Action; throw "$Name was accepted" }
  catch { if ($_.Exception.Message -notmatch $Pattern) { throw "$Name failed for wrong reason: $($_.Exception.Message)" } }
}

$base = Get-FixtureEvidence (New-ObjectPackage 'rId7' 'QUJD')
$approval = [pscustomobject]@{
  sourceIdentity = $base.sourceIdentity; sourceDigest = $base.sourceDigest
  sourceCellId = $base.sourceCellId; templateId = $base.templateId; tableRole = $base.tableRole
  sourceTableIndex = $base.sourceTableIndex; containerCategory = $base.containerCategory
}
$accepted = Assert-ReviewedSourceObjects -Candidates @($base) -Approvals @($approval) `
  -TemplateId 'fixture-template' -TableRole 'reference' -SourceTableIndex 7
if (@($accepted).Count -ne 1) { throw 'valid source object was not authenticated' }

$volatileIdOnly = Get-FixtureEvidence (New-ObjectPackage 'rId999' 'QUJD')
if ($volatileIdOnly.sourceDigest -ne $base.sourceDigest) { throw 'volatile relationship/object IDs changed stable digest' }

$mutatedPayload = Get-FixtureEvidence (New-ObjectPackage 'rId7' 'REVG')
Expect-Rejection 'mutated OLE payload' { Assert-ReviewedSourceObjects @($mutatedPayload) @($approval) 'fixture-template' 'reference' 7 } 'digest'

$replacedObject = Get-FixtureEvidence (New-ObjectPackage 'rId7' 'QUJD' '999')
Expect-Rejection 'replaced object metadata' { Assert-ReviewedSourceObjects @($replacedObject) @($approval) 'fixture-template' 'reference' 7 } 'digest'

$lineBase = Get-LineEvidence '_volatile-line-1'
$lineVolatileId = Get-LineEvidence '_volatile-line-999'
if ($lineBase.sourceDigest -ne $lineVolatileId.sourceDigest) { throw 'volatile VML object ID changed stable line digest' }
$lineApproval = [pscustomobject]@{ sourceIdentity = $lineBase.sourceIdentity; sourceDigest = $lineBase.sourceDigest; sourceCellId = $lineBase.sourceCellId; templateId = 'line-template'; tableRole = 'sample'; sourceTableIndex = 8; containerCategory = 'floating-overline' }
$lineMutation = Get-LineEvidence '_volatile-line-1' '100pt,2.3pt' '108pt,2.35pt'
Expect-Rejection 'mutated floating overline geometry' { Assert-ReviewedSourceObjects @($lineMutation) @($lineApproval) 'line-template' 'sample' 8 } 'digest'

$moved = $base.PSObject.Copy(); $moved.sourceCellId = 'reference-r6c1'; $moved.sourceIdentity = 'fixture-template|reference|7|reference-r6c1|object1'
Expect-Rejection 'moved source object' { Assert-ReviewedSourceObjects @($moved) @($approval) 'fixture-template' 'reference' 7 } 'identity|cell'

Expect-Rejection 'duplicated source object' { Assert-ReviewedSourceObjects @($base,$base) @($approval) 'fixture-template' 'reference' 7 } 'count|duplicate'
Expect-Rejection 'lost source object' { Assert-ReviewedSourceObjects @() @($approval) 'fixture-template' 'reference' 7 } 'count|missing'

$unknown = $base.PSObject.Copy(); $unknown.sourceDigest = '0' * 64
Expect-Rejection 'unknown source digest' { Assert-ReviewedSourceObjects @($unknown) @($approval) 'fixture-template' 'reference' 7 } 'digest'

$wrongRole = $base.PSObject.Copy(); $wrongRole.tableRole = 'sample'
Expect-Rejection 'wrong table role' { Assert-ReviewedSourceObjects @($wrongRole) @($approval) 'fixture-template' 'reference' 7 } 'role|context'
$wrongTable = $base.PSObject.Copy(); $wrongTable.sourceTableIndex = 8
Expect-Rejection 'wrong source table' { Assert-ReviewedSourceObjects @($wrongTable) @($approval) 'fixture-template' 'reference' 7 } 'table|context'
$wrongTemplate = $base.PSObject.Copy(); $wrongTemplate.templateId = 'other-template'
Expect-Rejection 'wrong template' { Assert-ReviewedSourceObjects @($wrongTemplate) @($approval) 'fixture-template' 'reference' 7 } 'template|context'

Write-Host 'PASS: source-derived embedded-object digests authenticate payload, identity, cell, table and role; mutations/moves/duplicates/loss fail closed'
