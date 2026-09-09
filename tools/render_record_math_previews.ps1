param([string]$Inventory=(Join-Path (Split-Path -Parent $PSScriptRoot) 'output/record-table-inventory'))
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$requests=Get-Content (Join-Path $Inventory 'unknown-mean-previews.json') -Raw | ConvertFrom-Json
$number=0
foreach($request in $requests){
  [xml]$xml=Get-Content (Join-Path $Inventory ($request.sourceId+'.xml')) -Raw
  $ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('pkg','http://schemas.microsoft.com/office/2006/xmlPackage')
  foreach($part in $xml.SelectNodes('/pkg:package/pkg:part[pkg:binaryData]',$ns)){
    $bytes=[Convert]::FromBase64String($part.SelectSingleNode('pkg:binaryData',$ns).InnerText)
    $hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    if($hash -notin $request.payloads -or $hash -eq '9aa619e3e7490b7761d4a612afaa22f01ef1713330597bc2a5bd0747cb8fde59'){continue}
    $stream=[IO.MemoryStream]::new($bytes,$false);$image=[Drawing.Image]::FromStream($stream)
    $bitmap=[Drawing.Bitmap]::new(240,160);$graphics=[Drawing.Graphics]::FromImage($bitmap)
    try{$graphics.Clear([Drawing.Color]::White);$graphics.DrawImage($image,20,20,200,120);$number++;$bitmap.Save((Join-Path $Inventory "math-preview-$number.png"),[Drawing.Imaging.ImageFormat]::Png);Write-Output "$number $hash"}
    finally{$graphics.Dispose();$bitmap.Dispose();$image.Dispose();$stream.Dispose()}
  }
}
