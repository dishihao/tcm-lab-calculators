param(
  [string]$RecordsBase = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'output/record-table-inventory'),
  [int]$MaxFiles = 0
)
$ErrorActionPreference = 'Stop'
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
[void][IO.Directory]::CreateDirectory($OutputDirectory)
$roots = @(@{name='原料检验记录';kind='原料'}, @{name='成品检验记录';kind='成品'})
$files = @(foreach ($root in $roots) {
  Get-ChildItem -LiteralPath (Join-Path $RecordsBase $root.name) -Recurse -File |
    Where-Object { $_.Extension -in '.doc','.docx' -and -not $_.Name.StartsWith('~$') } |
    Sort-Object FullName | ForEach-Object { @{file=$_;kind=$root.kind;root=$root.name} }
})
if ($MaxFiles -gt 0) { $files = @($files | Select-Object -First $MaxFiles) }
$word=$null; $index=[Collections.Generic.List[object]]::new(); $processed=0
try {
  foreach ($entry in $files) {
    $file=$entry.file
    $identity = $entry.kind + '|' + [IO.Path]::GetRelativePath((Join-Path $RecordsBase $entry.root), $file.FullName)
    $id=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($identity))).ToLowerInvariant()
    $jsonPath=Join-Path $OutputDirectory ($id+'.json')
    $xmlPath=Join-Path $OutputDirectory ($id+'.xml')
    $before=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    if (Test-Path -LiteralPath $jsonPath) {
      $cached=Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json
      if ($cached.status -eq 'ok' -and $cached.sha256Before -eq $before -and (Test-Path -LiteralPath $xmlPath)) {
        $index.Add($cached); $processed++; continue
      }
    }
    $doc=$null; $temporary=$null
    $result=[ordered]@{id=$id;kind=$entry.kind;sourceFile=$file.Name;sourcePath=$file.FullName;sha256Before=$before;status='error';tables=@();error=$null;usedTempRecovery=$false}
    try {
      if (-not $word) { $word=New-Object -ComObject Word.Application; $word.Visible=$false; $word.DisplayAlerts=0; $word.AutomationSecurity=3 }
      try { $doc=$word.Documents.Open($file.FullName,$false,$true,$false) } catch {
        $stream=[IO.File]::OpenRead($file.FullName)
        try { $signature=[byte[]]::new(8); [void]$stream.Read($signature,0,8) } finally { $stream.Dispose() }
        if ($file.Extension -ne '.docx' -or [Convert]::ToHexString($signature) -ne 'D0CF11E0A1B11AE1') { throw }
        $temporary=Join-Path ([IO.Path]::GetTempPath()) ('record-inventory-'+[guid]::NewGuid().ToString('N')+'.doc')
        Copy-Item -LiteralPath $file.FullName -Destination $temporary
        $doc=$word.Documents.Open($temporary,$false,$true,$false)
        $result.usedTempRecovery=$true
      }
      $result.readOnly=[bool]$doc.ReadOnly
      if (-not $result.readOnly) { throw 'Source did not open read-only' }
      $xmlText=[string]$doc.Content.WordOpenXML
      [xml]$xml=$xmlText
      $ns=[Xml.XmlNamespaceManager]::new($xml.NameTable)
      $ns.AddNamespace('pkg','http://schemas.microsoft.com/office/2006/xmlPackage')
      $ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
      $body=$xml.SelectSingleNode("/pkg:package/pkg:part[@pkg:name='/word/document.xml']/pkg:xmlData/w:document/w:body",$ns)
      if (-not $body) { throw 'Missing document body' }
      $paragraphs=[Collections.Generic.List[string]]::new()
      $tables=[Collections.Generic.List[object]]::new()
      foreach ($node in $body.ChildNodes) {
        $text=(@($node.SelectNodes('.//w:t',$ns)) | ForEach-Object { $_.InnerText }) -join ''
        if ($node.LocalName -eq 'tbl') {
          $rows=@($node.SelectNodes('w:tr',$ns))
          $cells=@($node.SelectNodes('w:tr/w:tc',$ns))
          $cellTexts=@(foreach ($cell in $cells) { (@($cell.SelectNodes('.//w:t',$ns)) | ForEach-Object {$_.InnerText}) -join '' })
          $tables.Add([ordered]@{index=$tables.Count+1;context=@($paragraphs | Select-Object -Last 10);rows=$rows.Count;cells=$cellTexts;text=$text;embeddedObjects=$node.SelectNodes('.//w:object|.//w:pict|.//w:drawing',$ns).Count;nestedTables=$node.SelectNodes('.//w:tbl',$ns).Count})
        } elseif ($text.Trim()) { $paragraphs.Add($text) }
      }
      $result.tables=@($tables.ToArray())
      $result.paragraphs=@($paragraphs.ToArray())
      [IO.File]::WriteAllText($xmlPath,$xmlText,[Text.UTF8Encoding]::new($false))
      $result.status='ok'
    } catch { $result.error=$_.Exception.Message } finally {
      if ($doc) { try {$doc.Close($false)} finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc) } }
      if ($temporary -and (Test-Path -LiteralPath $temporary)) { Remove-Item -LiteralPath $temporary }
      $result.sha256After=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
      if ($result.sha256After -ne $before) { $result.status='error'; $result.error='SOURCE HASH CHANGED' }
      [IO.File]::WriteAllText($jsonPath,($result | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
      $index.Add([pscustomobject]$result)
    }
    $processed++
    if ($processed % 20 -eq 0) { Write-Host "Inventoried $processed/$($files.Count)" }
    if ($processed % 100 -eq 0 -and $word) { $word.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word); $word=$null }
  }
} finally {
  if ($word) { $word.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
  $summary=[ordered]@{files=$files.Count;processed=$index.Count;ok=@($index | Where-Object status -eq 'ok').Count;errors=@($index | Where-Object status -ne 'ok' | Select-Object id,sourceFile,error);tableCount=($index | ForEach-Object { $_.tables.Count } | Measure-Object -Sum).Sum}
  [IO.File]::WriteAllText((Join-Path $OutputDirectory 'summary.json'),($summary | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
  $summary | ConvertTo-Json -Depth 8 | Write-Host
}
