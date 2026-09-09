param([Parameter(Mandatory)][string]$SourceId,[Parameter(Mandatory)][int]$TableIndex)
$ErrorActionPreference='Stop'
$directory=Join-Path (Split-Path -Parent $PSScriptRoot) 'output/record-table-inventory'
$source=Get-Content (Join-Path $directory ($SourceId+'.json')) -Raw | ConvertFrom-Json
$before=(Get-FileHash -LiteralPath $source.sourcePath -Algorithm SHA256).Hash
$word=$null;$doc=$null;$target=$null
try{
  $word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0;$word.AutomationSecurity=3
  $doc=$word.Documents.Open($source.sourcePath,$false,$true,$false)
  if(-not $doc.ReadOnly){throw 'Source is not read-only'}
  $expected=(@($source.tables | Where-Object index -eq $TableIndex)[0].text -replace '[\s\x00-\x1f]','')
  $matches=@(for($i=1;$i -le $doc.Tables.Count;$i++){
    if(($doc.Tables.Item($i).Range.Text -replace '[\s\x00-\x1f]','') -eq $expected){$i}
  })
  $sourceMatches=@($source.tables | Where-Object {($_.text -replace '[\s\x00-\x1f]','') -eq $expected})
  if(-not $matches.Count -or $matches.Count -ne $sourceMatches.Count){throw 'Word and XML matching table counts differ'}
  $ordinal=[array]::IndexOf([int[]]@($sourceMatches.index),$TableIndex)
  if($ordinal -lt 0){throw 'Source table occurrence is missing'}
  $target=$word.Documents.Add()
  foreach($property in 'PageWidth','PageHeight','TopMargin','BottomMargin','LeftMargin','RightMargin'){$target.PageSetup.$property=$doc.PageSetup.$property}
  $target.Content.FormattedText=$doc.Tables.Item([int]$matches[$ordinal]).Range.FormattedText
  $end=$target.Tables.Item(1).Range.End
  if($target.Content.End -gt $end){[void]$target.Range($end,$target.Content.End).Delete()}
  $pdf=Join-Path $directory ('source-preview-'+$TableIndex+'.pdf')
  $target.ExportAsFixedFormat($pdf,17)
  $poppler='C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe'
  & $poppler -f 1 -singlefile -png -scale-to 1400 $pdf (Join-Path $directory ('source-preview-'+$TableIndex))
  if($LASTEXITCODE -ne 0){throw 'PDF rendering failed'}
}finally{
  if($target){$target.Close($false);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($target)}
  if($doc){$doc.Close($false);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc)}
  if($word){$word.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)}
  if((Get-FileHash -LiteralPath $source.sourcePath -Algorithm SHA256).Hash -ne $before){throw 'SOURCE HASH CHANGED'}
}
