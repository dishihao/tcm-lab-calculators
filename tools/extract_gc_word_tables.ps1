param(
  [string]$WorkspaceRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$OutputPath = (Join-Path $PSScriptRoot 'gc-word-table-extract.json'),
  [string]$RecordsBase = ''
)

$ErrorActionPreference = 'Stop'
$WorkspaceRoot = [IO.Path]::GetFullPath($WorkspaceRoot)
if (-not [IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path $WorkspaceRoot $OutputPath
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)

if (-not $RecordsBase) {
  $gitCommonDir = (& git -C $WorkspaceRoot rev-parse --path-format=absolute --git-common-dir 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $gitCommonDir) {
    throw "Cannot resolve the Git common directory from $WorkspaceRoot"
  }
  $mainRepositoryRoot = Split-Path -Parent ([IO.Path]::GetFullPath($gitCommonDir.Trim()))
  $RecordsBase = Split-Path -Parent $mainRepositoryRoot
}
$RecordsBase = [IO.Path]::GetFullPath($RecordsBase)

$manifestPath = Join-Path $WorkspaceRoot 'tools\gc-word-table-manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
. (Join-Path $WorkspaceRoot 'tools\gc_word_open_recovery.ps1')
$embeddedRegistryPath = Join-Path $WorkspaceRoot 'tools\gc-word-embedded-object-semantics.json'
$embeddedRegistry = Get-Content -Raw -LiteralPath $embeddedRegistryPath | ConvertFrom-Json
if ($embeddedRegistry.version -ne 1 -or @($embeddedRegistry.entries).Count -ne 95) {
  throw 'embedded-object registry must contain the reviewed 95-entry version 1 set'
}
$script:embeddedApprovals = @{}
$script:embeddedApprovalsByTable = @{}
foreach ($approval in @($embeddedRegistry.entries)) {
  if ($script:embeddedApprovals.ContainsKey([string]$approval.identity)) {
    throw "duplicate embedded-object identity: $($approval.identity)"
  }
  $script:embeddedApprovals[[string]$approval.identity] = $approval
  $parts = ([string]$approval.identity).Split('|')
  $tableKey = "$($parts[0])|$($parts[1])|$($parts[2])"
  if (-not $script:embeddedApprovalsByTable.ContainsKey($tableKey)) { $script:embeddedApprovalsByTable[$tableKey] = @() }
  $script:embeddedApprovalsByTable[$tableKey] = @($script:embeddedApprovalsByTable[$tableKey]) + @($approval)
}
$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

$script:wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
$script:mNs = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
$script:pkgNs = 'http://schemas.microsoft.com/office/2006/xmlPackage'

function Get-NamespacedAttribute {
  param(
    [System.Xml.XmlNode]$Node,
    [string]$Name,
    [string]$Namespace = $script:wNs
  )

  if (-not $Node -or -not $Node.Attributes) { return $null }
  $attribute = $Node.Attributes.GetNamedItem($Name, $Namespace)
  if (-not $attribute) { return $null }
  return [string]$attribute.Value
}

function Convert-TwipsToPoints {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  return [Math]::Round(([double]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture) / 20.0), 4)
}

function Convert-HalfPointsToPoints {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  return [Math]::Round(([double]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture) / 2.0), 4)
}

function Convert-EighthPointsToPoints {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  return [Math]::Round(([double]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture) / 8.0), 4)
}

function Convert-OnOff {
  param([System.Xml.XmlNode]$Node)
  if (-not $Node) { return $null }
  $value = Get-NamespacedAttribute $Node 'val'
  if ([string]::IsNullOrWhiteSpace($value)) { return $true }
  return $value -notmatch '^(0|false|off|no)$'
}

function Convert-OnOffValue {
  param([string]$Value)
  if ($null -eq $Value) { return $null }
  if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
  return $Value -notmatch '^(0|false|off|no)$'
}

function Convert-WidthNode {
  param([System.Xml.XmlNode]$Node)
  if (-not $Node) { return $null }

  $type = Get-NamespacedAttribute $Node 'type'
  $value = Get-NamespacedAttribute $Node 'w'
  $valuePt = if ($type -eq 'dxa') { Convert-TwipsToPoints $value } else { $null }
  $percent = if ($type -eq 'pct' -and -not [string]::IsNullOrWhiteSpace($value)) {
    [Math]::Round(([double]::Parse($value, [Globalization.CultureInfo]::InvariantCulture) / 50.0), 4)
  } else {
    $null
  }

  return [pscustomobject]@{
    type = $type
    value = $value
    valuePt = $valuePt
    percent = $percent
  }
}

function Convert-ShadingNode {
  param([System.Xml.XmlNode]$Node)
  if (-not $Node) { return $null }
  return [pscustomobject]@{
    value = Get-NamespacedAttribute $Node 'val'
    color = Get-NamespacedAttribute $Node 'color'
    fill = Get-NamespacedAttribute $Node 'fill'
    themeColor = Get-NamespacedAttribute $Node 'themeColor'
    themeFill = Get-NamespacedAttribute $Node 'themeFill'
  }
}

function Convert-BorderNode {
  param([System.Xml.XmlNode]$Node)
  if (-not $Node) { return $null }
  $space = Get-NamespacedAttribute $Node 'space'
  return [pscustomobject]@{
    value = Get-NamespacedAttribute $Node 'val'
    sizePt = Convert-EighthPointsToPoints (Get-NamespacedAttribute $Node 'sz')
    spacePt = if ([string]::IsNullOrWhiteSpace($space)) { $null } else { [double]$space }
    color = Get-NamespacedAttribute $Node 'color'
    themeColor = Get-NamespacedAttribute $Node 'themeColor'
    shadow = Convert-OnOffValue (Get-NamespacedAttribute $Node 'shadow')
    frame = Convert-OnOffValue (Get-NamespacedAttribute $Node 'frame')
  }
}

function Convert-Borders {
  param(
    [System.Xml.XmlNode]$Parent,
    [System.Xml.XmlNamespaceManager]$NamespaceManager
  )
  if (-not $Parent) { return $null }

  $result = [ordered]@{}
  foreach ($name in @('top', 'left', 'bottom', 'right', 'insideH', 'insideV', 'tl2br', 'tr2bl', 'between', 'bar')) {
    $node = $Parent.SelectSingleNode("w:$name", $NamespaceManager)
    if ($node) { $result[$name] = Convert-BorderNode $node }
  }
  if ($result.Count -eq 0) { return $null }
  return [pscustomobject]$result
}

function Convert-Margins {
  param(
    [System.Xml.XmlNode]$Parent,
    [System.Xml.XmlNamespaceManager]$NamespaceManager
  )
  if (-not $Parent) { return $null }

  $result = [ordered]@{}
  foreach ($name in @('top', 'left', 'bottom', 'right', 'start', 'end')) {
    $node = $Parent.SelectSingleNode("w:$name", $NamespaceManager)
    if ($node) { $result[$name] = Convert-WidthNode $node }
  }
  if ($result.Count -eq 0) { return $null }
  return [pscustomobject]$result
}

function Get-RunText {
  param(
    [System.Xml.XmlNode]$RunNode,
    [System.Xml.XmlNamespaceManager]$NamespaceManager
  )

  $parts = [Collections.Generic.List[string]]::new()
  foreach ($node in @($RunNode.SelectNodes('.//w:t | .//w:instrText | .//w:tab | .//w:br | .//w:cr | .//w:noBreakHyphen | .//w:softHyphen', $NamespaceManager))) {
    switch ($node.LocalName) {
      'tab' { $parts.Add("`t") }
      'br' { $parts.Add("`n") }
      'cr' { $parts.Add("`n") }
      'noBreakHyphen' { $parts.Add([char]0x2011) }
      'softHyphen' { $parts.Add([char]0x00AD) }
      default { $parts.Add([string]$node.InnerText) }
    }
  }
  return ($parts -join '')
}

function Convert-RunProperties {
  param(
    [System.Xml.XmlNode]$Properties,
    [System.Xml.XmlNamespaceManager]$NamespaceManager
  )
  if (-not $Properties) { return $null }

  $fonts = $Properties.SelectSingleNode('w:rFonts', $NamespaceManager)
  $underline = $Properties.SelectSingleNode('w:u', $NamespaceManager)
  $color = $Properties.SelectSingleNode('w:color', $NamespaceManager)
  $language = $Properties.SelectSingleNode('w:lang', $NamespaceManager)
  $spacing = $Properties.SelectSingleNode('w:spacing', $NamespaceManager)
  $position = $Properties.SelectSingleNode('w:position', $NamespaceManager)

  return [pscustomobject]@{
    styleId = Get-NamespacedAttribute ($Properties.SelectSingleNode('w:rStyle', $NamespaceManager)) 'val'
    bold = Convert-OnOff ($Properties.SelectSingleNode('w:b', $NamespaceManager))
    boldComplexScript = Convert-OnOff ($Properties.SelectSingleNode('w:bCs', $NamespaceManager))
    italic = Convert-OnOff ($Properties.SelectSingleNode('w:i', $NamespaceManager))
    italicComplexScript = Convert-OnOff ($Properties.SelectSingleNode('w:iCs', $NamespaceManager))
    strike = Convert-OnOff ($Properties.SelectSingleNode('w:strike', $NamespaceManager))
    doubleStrike = Convert-OnOff ($Properties.SelectSingleNode('w:dstrike', $NamespaceManager))
    caps = Convert-OnOff ($Properties.SelectSingleNode('w:caps', $NamespaceManager))
    smallCaps = Convert-OnOff ($Properties.SelectSingleNode('w:smallCaps', $NamespaceManager))
    vanish = Convert-OnOff ($Properties.SelectSingleNode('w:vanish', $NamespaceManager))
    underline = if ($underline) {
      [pscustomobject]@{
        value = Get-NamespacedAttribute $underline 'val'
        color = Get-NamespacedAttribute $underline 'color'
        themeColor = Get-NamespacedAttribute $underline 'themeColor'
      }
    } else { $null }
    fonts = if ($fonts) {
      [pscustomobject]@{
        ascii = Get-NamespacedAttribute $fonts 'ascii'
        highAnsi = Get-NamespacedAttribute $fonts 'hAnsi'
        eastAsia = Get-NamespacedAttribute $fonts 'eastAsia'
        complexScript = Get-NamespacedAttribute $fonts 'cs'
        asciiTheme = Get-NamespacedAttribute $fonts 'asciiTheme'
        highAnsiTheme = Get-NamespacedAttribute $fonts 'hAnsiTheme'
        eastAsiaTheme = Get-NamespacedAttribute $fonts 'eastAsiaTheme'
        complexScriptTheme = Get-NamespacedAttribute $fonts 'cstheme'
      }
    } else { $null }
    fontSizePt = Convert-HalfPointsToPoints (Get-NamespacedAttribute ($Properties.SelectSingleNode('w:sz', $NamespaceManager)) 'val')
    complexScriptFontSizePt = Convert-HalfPointsToPoints (Get-NamespacedAttribute ($Properties.SelectSingleNode('w:szCs', $NamespaceManager)) 'val')
    color = if ($color) {
      [pscustomobject]@{
        value = Get-NamespacedAttribute $color 'val'
        themeColor = Get-NamespacedAttribute $color 'themeColor'
        themeTint = Get-NamespacedAttribute $color 'themeTint'
        themeShade = Get-NamespacedAttribute $color 'themeShade'
      }
    } else { $null }
    highlight = Get-NamespacedAttribute ($Properties.SelectSingleNode('w:highlight', $NamespaceManager)) 'val'
    verticalAlign = Get-NamespacedAttribute ($Properties.SelectSingleNode('w:vertAlign', $NamespaceManager)) 'val'
    characterSpacingPt = Convert-TwipsToPoints (Get-NamespacedAttribute $spacing 'val')
    positionPt = Convert-HalfPointsToPoints (Get-NamespacedAttribute $position 'val')
    language = if ($language) {
      [pscustomobject]@{
        latin = Get-NamespacedAttribute $language 'val'
        eastAsia = Get-NamespacedAttribute $language 'eastAsia'
        bidirectional = Get-NamespacedAttribute $language 'bidi'
      }
    } else { $null }
    border = Convert-BorderNode ($Properties.SelectSingleNode('w:bdr', $NamespaceManager))
    shading = Convert-ShadingNode ($Properties.SelectSingleNode('w:shd', $NamespaceManager))
  }
}

function Convert-ParagraphProperties {
  param(
    [System.Xml.XmlNode]$Properties,
    [System.Xml.XmlNamespaceManager]$NamespaceManager
  )
  if (-not $Properties) { return $null }

  $indent = $Properties.SelectSingleNode('w:ind', $NamespaceManager)
  $spacing = $Properties.SelectSingleNode('w:spacing', $NamespaceManager)
  $tabs = @(
    foreach ($tab in @($Properties.SelectNodes('w:tabs/w:tab', $NamespaceManager))) {
      [pscustomobject]@{
        value = Get-NamespacedAttribute $tab 'val'
        positionPt = Convert-TwipsToPoints (Get-NamespacedAttribute $tab 'pos')
        leader = Get-NamespacedAttribute $tab 'leader'
      }
    }
  )

  return [pscustomobject]@{
    styleId = Get-NamespacedAttribute ($Properties.SelectSingleNode('w:pStyle', $NamespaceManager)) 'val'
    alignment = Get-NamespacedAttribute ($Properties.SelectSingleNode('w:jc', $NamespaceManager)) 'val'
    keepNext = Convert-OnOff ($Properties.SelectSingleNode('w:keepNext', $NamespaceManager))
    keepLines = Convert-OnOff ($Properties.SelectSingleNode('w:keepLines', $NamespaceManager))
    pageBreakBefore = Convert-OnOff ($Properties.SelectSingleNode('w:pageBreakBefore', $NamespaceManager))
    widowControl = Convert-OnOff ($Properties.SelectSingleNode('w:widowControl', $NamespaceManager))
    bidirectional = Convert-OnOff ($Properties.SelectSingleNode('w:bidi', $NamespaceManager))
    indentation = if ($indent) {
      [pscustomobject]@{
        leftPt = Convert-TwipsToPoints (Get-NamespacedAttribute $indent 'left')
        rightPt = Convert-TwipsToPoints (Get-NamespacedAttribute $indent 'right')
        startPt = Convert-TwipsToPoints (Get-NamespacedAttribute $indent 'start')
        endPt = Convert-TwipsToPoints (Get-NamespacedAttribute $indent 'end')
        firstLinePt = Convert-TwipsToPoints (Get-NamespacedAttribute $indent 'firstLine')
        hangingPt = Convert-TwipsToPoints (Get-NamespacedAttribute $indent 'hanging')
      }
    } else { $null }
    spacing = if ($spacing) {
      [pscustomobject]@{
        beforePt = Convert-TwipsToPoints (Get-NamespacedAttribute $spacing 'before')
        afterPt = Convert-TwipsToPoints (Get-NamespacedAttribute $spacing 'after')
        line = Get-NamespacedAttribute $spacing 'line'
        lineRule = Get-NamespacedAttribute $spacing 'lineRule'
      }
    } else { $null }
    tabs = $tabs
    borders = Convert-Borders ($Properties.SelectSingleNode('w:pBdr', $NamespaceManager)) $NamespaceManager
    shading = Convert-ShadingNode ($Properties.SelectSingleNode('w:shd', $NamespaceManager))
    defaultRunProperties = Convert-RunProperties ($Properties.SelectSingleNode('w:rPr', $NamespaceManager)) $NamespaceManager
  }
}

function Convert-Paragraph {
  param(
    [System.Xml.XmlNode]$ParagraphNode,
    [System.Xml.XmlNamespaceManager]$NamespaceManager,
    [int]$ParagraphIndex,
    $Context
  )

  $runs = [Collections.Generic.List[object]]::new()
  $contentNodes = $ParagraphNode.SelectNodes(
    './/w:r[not(ancestor::w:r) and not(ancestor::m:oMath) and not(ancestor::m:oMathPara)] | .//*[self::m:oMathPara or self::m:oMath][not(ancestor::m:oMathPara or ancestor::m:oMath)] | .//*[self::w:object or self::w:pict or self::w:drawing or local-name()="AlternateContent"][not(ancestor::w:r) and not(ancestor::m:oMath) and not(ancestor::m:oMathPara) and not(ancestor::*[self::w:object or self::w:pict or self::w:drawing or local-name()="AlternateContent"])]',
    $NamespaceManager
  )
  foreach ($contentNode in @($contentNodes)) {
    if ($contentNode.NamespaceURI -eq $script:mNs) {
      $runs.Add([pscustomobject]@{
        runIndex = $runs.Count + 1
        kind = 'math'
        text = [string]$contentNode.InnerText
        properties = $null
        ooxml = $null
        mathOoxml = $contentNode.OuterXml
      })
    } else {
      $runIndex = $runs.Count + 1
      $objectOrdinal = if ($Context) { [int]$Context.objectCount + 1 } else { 1 }
      $identity = if ($Context) {
        "$($Context.templateId)|$($Context.tableRole)|$($Context.sourceTableIndex)|r$($Context.rowIndex)c$($Context.gridColumnIndex)|object$objectOrdinal"
      } else { 'unknown|unknown|0|r0c0|object1' }
      $embedded = Get-ApprovedEmbeddedObjectRun $contentNode $identity $NamespaceManager
      if ($embedded) {
        if ($Context) { $Context.objectCount = $objectOrdinal }
        $embedded | Add-Member -NotePropertyName runIndex -NotePropertyValue $runIndex
        $embedded | Add-Member -NotePropertyName text -NotePropertyValue ''
        $runs.Add($embedded)
      } else {
        $runs.Add([pscustomobject]@{
          runIndex = $runIndex
          kind = 'text'
          text = Get-RunText $contentNode $NamespaceManager
          properties = Convert-RunProperties ($contentNode.SelectSingleNode('w:rPr', $NamespaceManager)) $NamespaceManager
          ooxml = $contentNode.OuterXml
          mathOoxml = $null
        })
      }
    }
  }

  return [pscustomobject]@{
    paragraphIndex = $ParagraphIndex
    text = (($runs | ForEach-Object { $_.text }) -join '')
    properties = Convert-ParagraphProperties ($ParagraphNode.SelectSingleNode('w:pPr', $NamespaceManager)) $NamespaceManager
    runs = @($runs)
    ooxml = $ParagraphNode.OuterXml
  }
}

function Convert-Cell {
  param(
    [System.Xml.XmlNode]$CellNode,
    [System.Xml.XmlNamespaceManager]$NamespaceManager,
    [int]$RowIndex,
    [int]$CellIndex,
    [int]$GridColumnIndex,
    $Context
  )

  $properties = $CellNode.SelectSingleNode('w:tcPr', $NamespaceManager)
  $gridSpanValue = Get-NamespacedAttribute ($properties.SelectSingleNode('w:gridSpan', $NamespaceManager)) 'val'
  $gridSpan = if ([string]::IsNullOrWhiteSpace($gridSpanValue)) { 1 } else { [int]$gridSpanValue }
  $verticalMergeNode = $properties.SelectSingleNode('w:vMerge', $NamespaceManager)
  $verticalMerge = if ($verticalMergeNode) {
    $value = Get-NamespacedAttribute $verticalMergeNode 'val'
    if ([string]::IsNullOrWhiteSpace($value)) { 'continue' } else { $value }
  } else { $null }

  $paragraphs = [Collections.Generic.List[object]]::new()
  $cellContext = [pscustomobject]@{
    templateId = $Context.templateId
    tableRole = $Context.tableRole
    sourceTableIndex = $Context.sourceTableIndex
    rowIndex = $RowIndex
    gridColumnIndex = $GridColumnIndex
    objectCount = 0
  }
  foreach ($contentNode in @($CellNode.SelectNodes('./w:p | ./m:oMathPara | ./m:oMath', $NamespaceManager))) {
    if ($contentNode.NamespaceURI -eq $script:wNs) {
      $paragraphs.Add((Convert-Paragraph $contentNode $NamespaceManager ($paragraphs.Count + 1) $cellContext))
    } else {
      $paragraphs.Add([pscustomobject]@{
        paragraphIndex = $paragraphs.Count + 1
        text = [string]$contentNode.InnerText
        properties = $null
        runs = @([pscustomobject]@{
          runIndex = 1
          kind = 'math'
          text = [string]$contentNode.InnerText
          properties = $null
          ooxml = $null
          mathOoxml = $contentNode.OuterXml
        })
        ooxml = $contentNode.OuterXml
      })
    }
  }

  return [pscustomobject]@{
    rowIndex = $RowIndex
    cellIndex = $CellIndex
    gridColumnIndex = $GridColumnIndex
    gridSpan = $gridSpan
    verticalMerge = $verticalMerge
    width = Convert-WidthNode ($properties.SelectSingleNode('w:tcW', $NamespaceManager))
    margins = Convert-Margins ($properties.SelectSingleNode('w:tcMar', $NamespaceManager)) $NamespaceManager
    borders = Convert-Borders ($properties.SelectSingleNode('w:tcBorders', $NamespaceManager)) $NamespaceManager
    shading = Convert-ShadingNode ($properties.SelectSingleNode('w:shd', $NamespaceManager))
    verticalAlign = Get-NamespacedAttribute ($properties.SelectSingleNode('w:vAlign', $NamespaceManager)) 'val'
    textDirection = Get-NamespacedAttribute ($properties.SelectSingleNode('w:textDirection', $NamespaceManager)) 'val'
    noWrap = Convert-OnOff ($properties.SelectSingleNode('w:noWrap', $NamespaceManager))
    fitText = Convert-OnOff ($properties.SelectSingleNode('w:tcFitText', $NamespaceManager))
    hideMark = Convert-OnOff ($properties.SelectSingleNode('w:hideMark', $NamespaceManager))
    text = (($paragraphs | ForEach-Object { $_.text }) -join "`n")
    paragraphs = @($paragraphs)
    ooxml = $CellNode.OuterXml
  }
}

function Get-Sha256Hex {
  param([string]$Text)
  $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return [Convert]::ToHexString($sha.ComputeHash($bytes)).ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function ConvertTo-StableEmbeddedXml {
  param([System.Xml.XmlNode]$Node)
  if ($Node.NodeType -eq [Xml.XmlNodeType]::Text -or $Node.NodeType -eq [Xml.XmlNodeType]::CDATA) {
    return "T($($Node.Value))"
  }
  if ($Node.NodeType -ne [Xml.XmlNodeType]::Element) { return '' }
  if (@('object','pict','drawing','AlternateContent') -contains $Node.LocalName) {
    return 'E(reviewed-visible-object)'
  }
  $volatileAttributes = @('id','spid','ShapeID','ObjectID')
  $attributes = @($Node.Attributes | Where-Object {
    $_.Prefix -ne 'xmlns' -and $_.Name -ne 'xmlns' -and $volatileAttributes -notcontains $_.LocalName
  } | Sort-Object LocalName, NamespaceURI | ForEach-Object { "$($_.LocalName)=$($_.Value)" }) -join ';'
  $children = @($Node.ChildNodes | ForEach-Object { ConvertTo-StableEmbeddedXml $_ }) -join ''
  return "E($($Node.LocalName)|$attributes|$children)"
}

function Get-StableEmbeddedObjectHash {
  param([System.Xml.XmlNode]$Node)
  return Get-Sha256Hex (ConvertTo-StableEmbeddedXml $Node)
}

function Get-ApprovedEmbeddedObjectRun {
  param(
    [System.Xml.XmlNode]$RunNode,
    [string]$Identity,
    [System.Xml.XmlNamespaceManager]$NamespaceManager
  )

  $allowedTextChildren = @('rPr','t','instrText','tab','br','cr','noBreakHyphen','softHyphen')
  $visibleChildren = @()
  if ($RunNode.LocalName -eq 'r') {
    foreach ($child in @($RunNode.ChildNodes)) {
      if ($child.NodeType -ne [Xml.XmlNodeType]::Element) { continue }
      if ($allowedTextChildren -contains $child.LocalName) { continue }
      if (@('object','pict','drawing','AlternateContent') -contains $child.LocalName) {
        $visibleChildren += $child
        continue
      }
      throw "${Identity}: unsupported visible/non-text run child $($child.Name)"
    }
  } elseif (@('object','pict','drawing','AlternateContent') -contains $RunNode.LocalName) {
    $visibleChildren = @($RunNode)
  } else {
    throw "${Identity}: unsupported visible/non-text container $($RunNode.Name)"
  }
  if ($visibleChildren.Count -eq 0) { return $null }
  if ($visibleChildren.Count -ne 1) { throw "${Identity}: expected one visible embedded-object container, got $($visibleChildren.Count)" }

  return [pscustomobject]@{
    kind = 'sourceObject'
    containerType = [string]$visibleChildren[0].LocalName
    sourceObjectHash = Get-StableEmbeddedObjectHash $visibleChildren[0]
    properties = if ($RunNode.LocalName -eq 'r') {
      Convert-RunProperties ($RunNode.SelectSingleNode('w:rPr', $NamespaceManager)) $NamespaceManager
    } else { $null }
  }
}

function Convert-TableCapture {
  param(
    [pscustomobject]$Capture,
    [string]$Role,
    [int]$SourceTableIndex,
    [string]$TemplateId
  )

  [xml]$xmlDocument = $Capture.wordOpenXml
  $namespaceManager = [Xml.XmlNamespaceManager]::new($xmlDocument.NameTable)
  $namespaceManager.AddNamespace('pkg', $script:pkgNs)
  $namespaceManager.AddNamespace('w', $script:wNs)
  $namespaceManager.AddNamespace('m', $script:mNs)
  $tableNode = $xmlDocument.SelectSingleNode("/pkg:package/pkg:part[@pkg:name='/word/document.xml']/pkg:xmlData/w:document/w:body/w:tbl", $namespaceManager)
  if (-not $tableNode) { throw "Table $SourceTableIndex has no w:tbl in WordOpenXML" }

  $gridPt = @(
    foreach ($gridColumn in @($tableNode.SelectNodes('w:tblGrid/w:gridCol', $namespaceManager))) {
      Convert-TwipsToPoints (Get-NamespacedAttribute $gridColumn 'w')
    }
  )
  if ($gridPt.Count -eq 0) { throw "Table $SourceTableIndex has no w:tblGrid columns" }
  $tableApprovalKey = "$TemplateId|$Role|$SourceTableIndex"
  $tableApprovals = @($script:embeddedApprovalsByTable[$tableApprovalKey])
  if ($tableApprovals.Count -eq 0) { throw "$tableApprovalKey has no reviewed embedded-object approvals" }

  $rows = [Collections.Generic.List[object]]::new()
  $cells = [Collections.Generic.List[object]]::new()
  foreach ($rowNode in @($tableNode.SelectNodes('w:tr', $namespaceManager))) {
    $rowIndex = $rows.Count + 1
    $rowProperties = $rowNode.SelectSingleNode('w:trPr', $namespaceManager)
    $heightNode = $rowProperties.SelectSingleNode('w:trHeight', $namespaceManager)
    $heightPt = Convert-TwipsToPoints (Get-NamespacedAttribute $heightNode 'val')
    $rowCells = [Collections.Generic.List[int]]::new()
    $gridColumnIndex = 1
    $cellIndex = 0
    foreach ($cellNode in @($rowNode.SelectNodes('w:tc', $namespaceManager))) {
      $cellIndex++
      $cell = Convert-Cell $cellNode $namespaceManager $rowIndex $cellIndex $gridColumnIndex ([pscustomobject]@{
        templateId = $TemplateId
        tableRole = $Role
        sourceTableIndex = $SourceTableIndex
      })
      $cells.Add($cell)
      $rowCells.Add($cells.Count)
      $gridColumnIndex += $cell.gridSpan
    }

    $rows.Add([pscustomobject]@{
      rowIndex = $rowIndex
      heightPt = $heightPt
      heightRule = Get-NamespacedAttribute $heightNode 'hRule'
      cantSplit = Convert-OnOff ($rowProperties.SelectSingleNode('w:cantSplit', $namespaceManager))
      repeatHeader = Convert-OnOff ($rowProperties.SelectSingleNode('w:tblHeader', $namespaceManager))
      gridBefore = Get-NamespacedAttribute ($rowProperties.SelectSingleNode('w:gridBefore', $namespaceManager)) 'val'
      gridAfter = Get-NamespacedAttribute ($rowProperties.SelectSingleNode('w:gridAfter', $namespaceManager)) 'val'
      cellIndexes = @($rowCells)
      ooxml = $rowNode.OuterXml
    })
  }

  $sourceObjects = @($cells | ForEach-Object { $_.paragraphs } | ForEach-Object { $_.runs } |
    Where-Object { $_.kind -eq 'sourceObject' })
  if ($sourceObjects.Count -ne $tableApprovals.Count) {
    throw "${tableApprovalKey}: source-visible object count $($sourceObjects.Count) differs from reviewed count $($tableApprovals.Count)"
  }
  $approvedObjects = @(
    foreach ($approval in $tableApprovals) {
      $candidate = if ($sourceObjects.Count -eq 1) { $sourceObjects[0] }
      elseif ($approval.semanticType -eq 'externalSampleAverage') {
        @($sourceObjects | Where-Object { $_.containerType -ne 'object' })[0]
      } elseif ($approval.semanticType -eq 'sampleMean') {
        @($sourceObjects | Where-Object { $_.containerType -eq 'object' })[0]
      } else { $sourceObjects[0] }
      if (-not $candidate) { throw "${tableApprovalKey}: no source object matches $($approval.semanticType)" }
      $containerCategory = if ($approval.semanticType -eq 'externalSampleAverage') { 'floating-overline' } else { 'embedded-equation' }
      $stableApprovalHash = Get-Sha256Hex ("gc-word-visible-object-v1|$($approval.identity)|$($approval.semanticType)|$containerCategory")
      if ($stableApprovalHash -ne $approval.objectHash) {
        throw "${tableApprovalKey}: unknown embedded object hash $stableApprovalHash for $($approval.identity)"
      }
      [pscustomobject]@{
        objectIdentity = $approval.identity
        objectHash = $stableApprovalHash
        semanticType = $approval.semanticType
        targetCellId = $approval.targetCellId
        consumeAdjacentText = $approval.consumeAdjacentText
        approved = $true
      }
    }
  )

  $tableProperties = $tableNode.SelectSingleNode('w:tblPr', $namespaceManager)
  $tablePosition = $tableProperties.SelectSingleNode('w:tblpPr', $namespaceManager)
  $tableLook = $tableProperties.SelectSingleNode('w:tblLook', $namespaceManager)

  return [pscustomobject]@{
    role = $Role
    sourceTableIndex = $SourceTableIndex
    widthPt = [Math]::Round((($gridPt | Measure-Object -Sum).Sum), 4)
    preferredWidth = $Capture.preferredWidth
    preferredWidthType = $Capture.preferredWidthType
    indentPt = $Capture.indentPt
    topPaddingPt = $Capture.topPaddingPt
    bottomPaddingPt = $Capture.bottomPaddingPt
    leftPaddingPt = $Capture.leftPaddingPt
    rightPaddingPt = $Capture.rightPaddingPt
    gridPt = $gridPt
    tableProperties = [pscustomobject]@{
      styleId = Get-NamespacedAttribute ($tableProperties.SelectSingleNode('w:tblStyle', $namespaceManager)) 'val'
      width = Convert-WidthNode ($tableProperties.SelectSingleNode('w:tblW', $namespaceManager))
      alignment = Get-NamespacedAttribute ($tableProperties.SelectSingleNode('w:jc', $namespaceManager)) 'val'
      layout = Get-NamespacedAttribute ($tableProperties.SelectSingleNode('w:tblLayout', $namespaceManager)) 'type'
      bidiVisual = Convert-OnOff ($tableProperties.SelectSingleNode('w:bidiVisual', $namespaceManager))
      cellSpacing = Convert-WidthNode ($tableProperties.SelectSingleNode('w:tblCellSpacing', $namespaceManager))
      cellMargins = Convert-Margins ($tableProperties.SelectSingleNode('w:tblCellMar', $namespaceManager)) $namespaceManager
      borders = Convert-Borders ($tableProperties.SelectSingleNode('w:tblBorders', $namespaceManager)) $namespaceManager
      shading = Convert-ShadingNode ($tableProperties.SelectSingleNode('w:shd', $namespaceManager))
      look = if ($tableLook) {
        [pscustomobject]@{
          value = Get-NamespacedAttribute $tableLook 'val'
          firstRow = Get-NamespacedAttribute $tableLook 'firstRow'
          lastRow = Get-NamespacedAttribute $tableLook 'lastRow'
          firstColumn = Get-NamespacedAttribute $tableLook 'firstColumn'
          lastColumn = Get-NamespacedAttribute $tableLook 'lastColumn'
          noHorizontalBand = Get-NamespacedAttribute $tableLook 'noHBand'
          noVerticalBand = Get-NamespacedAttribute $tableLook 'noVBand'
        }
      } else { $null }
      position = if ($tablePosition) {
        [pscustomobject]@{
          horizontalAnchor = Get-NamespacedAttribute $tablePosition 'horzAnchor'
          verticalAnchor = Get-NamespacedAttribute $tablePosition 'vertAnchor'
          tablePositionXPt = Convert-TwipsToPoints (Get-NamespacedAttribute $tablePosition 'tblpX')
          tablePositionYPt = Convert-TwipsToPoints (Get-NamespacedAttribute $tablePosition 'tblpY')
          leftFromTextPt = Convert-TwipsToPoints (Get-NamespacedAttribute $tablePosition 'leftFromText')
          rightFromTextPt = Convert-TwipsToPoints (Get-NamespacedAttribute $tablePosition 'rightFromText')
          topFromTextPt = Convert-TwipsToPoints (Get-NamespacedAttribute $tablePosition 'topFromText')
          bottomFromTextPt = Convert-TwipsToPoints (Get-NamespacedAttribute $tablePosition 'bottomFromText')
        }
      } else { $null }
    }
    rows = @($rows)
    cells = @($cells)
    embeddedObjects = $approvedObjects
    sourceOoxmlHash = Get-Sha256Hex (ConvertTo-StableEmbeddedXml $tableNode)
    wordOpenXml = $Capture.wordOpenXml
  }
}

function Get-TableCapture {
  param($Document, [int]$TableIndex)

  $table = $null
  $tableRange = $null
  $documentShapes = $null
  try {
    $table = $Document.Tables.Item($TableIndex)
    $tableRange = $table.Range
    $inlineShapeCount = [int]$tableRange.InlineShapes.Count
    $floatingLineShapeCount = 0
    $documentShapes = $Document.Shapes
    for ($shapeIndex = 1; $shapeIndex -le $documentShapes.Count; $shapeIndex++) {
      $shape = $null; $anchor = $null
      try {
        $shape = $documentShapes.Item($shapeIndex)
        $anchor = $shape.Anchor
        if ($shape.Type -eq 9 -and $anchor.Start -ge $tableRange.Start -and $anchor.Start -lt $tableRange.End) {
          $floatingLineShapeCount++
        }
      } finally {
        if ($anchor) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($anchor) } catch {} }
        if ($shape) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shape) } catch {} }
      }
    }
    return [pscustomobject]@{
      preferredWidth = [double]$table.PreferredWidth
      preferredWidthType = [int]$table.PreferredWidthType
      indentPt = [double]$table.Rows.LeftIndent
      topPaddingPt = [double]$table.TopPadding
      bottomPaddingPt = [double]$table.BottomPadding
      leftPaddingPt = [double]$table.LeftPadding
      rightPaddingPt = [double]$table.RightPadding
      inlineShapeCount = $inlineShapeCount
      floatingLineShapeCount = $floatingLineShapeCount
      wordOpenXml = [string]$table.Range.WordOpenXML
    }
  } finally {
    if ($documentShapes) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($documentShapes) } catch {} }
    if ($tableRange) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($tableRange) } catch {} }
    if ($table) {
      try { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($table) | Out-Null } catch {}
    }
  }
}

function New-WordApplication {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  return $word
}

$templates = [Collections.Generic.List[object]]::new()
$errors = [Collections.Generic.List[object]]::new()
$word = $null
try {
  $word = New-WordApplication
  foreach ($entry in @($manifest.entries)) {
    $sourcePath = Join-Path (Join-Path $RecordsBase $entry.root) $entry.sourceFile
    $opened = $null
    try {
      [void](Get-Item -LiteralPath $sourcePath)
      $opened = Open-GcWordDocumentReadOnly -SourcePath $sourcePath -Recovery $entry.tempRecovery -Word $word
      $referenceCapture = Get-TableCapture $opened.Document ([int]$entry.referenceTableIndex)
      $sampleCapture = Get-TableCapture $opened.Document ([int]$entry.sampleTableIndex)
      $templates.Add([pscustomobject]@{
        templateId = $entry.templateId
        sourceFile = $entry.sourceFile
        usedTempRecovery = $opened.usedTempRecovery
        recoveryReason = $opened.recoveryReason
        temporarySuffix = $opened.temporarySuffix
        referenceTable = Convert-TableCapture $referenceCapture 'reference' ([int]$entry.referenceTableIndex) ([string]$entry.templateId)
        sampleTable = Convert-TableCapture $sampleCapture 'sample' ([int]$entry.sampleTableIndex) ([string]$entry.templateId)
      })
    } catch {
      $errors.Add([pscustomobject]@{
        templateId = $entry.templateId
        sourceFile = $entry.sourceFile
        error = $_.Exception.Message
      })
    } finally {
      if ($opened -and $opened.Document) {
        try { $opened.Document.Close($false) } catch {}
        try { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($opened.Document) | Out-Null } catch {}
      }
      if ($opened -and $opened.TempPath -and (Test-Path -LiteralPath $opened.TempPath)) {
        Remove-Item -LiteralPath $opened.TempPath -Force
      }
    }
  }
} finally {
  if ($word) {
    try { $word.Quit() } catch {}
    try { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null } catch {}
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

[pscustomobject]@{
  generatedAt = [DateTime]::UtcNow.ToString('o')
  templates = @($templates)
  errors = @($errors)
} | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $OutputPath -Encoding utf8

$tableCount = $templates.Count * 2
Write-Host ("Extracted {0} templates / {1} tables; {2} errors" -f $templates.Count, $tableCount, $errors.Count)
