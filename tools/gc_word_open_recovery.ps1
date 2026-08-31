function Test-GcOleCompoundSignature {
  param([Parameter(Mandatory = $true)][string]$SourcePath)

  $stream = $null
  try {
    $stream = [IO.File]::Open($SourcePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    if ($stream.Length -lt 8) { return $false }
    $bytes = [byte[]]::new(8)
    if ($stream.Read($bytes, 0, 8) -ne 8) { return $false }
    $expected = [byte[]](0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1)
    for ($index = 0; $index -lt 8; $index++) {
      if ($bytes[$index] -ne $expected[$index]) { return $false }
    }
    return $true
  } finally {
    if ($stream) { $stream.Dispose() }
  }
}

function Open-GcWordDocumentReadOnly {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    $Recovery,
    $Word,
    [scriptblock]$OpenAction,
    [scriptblock]$CopyAction
  )

  if (-not $OpenAction) {
    if (-not $Word) { throw 'Word or OpenAction is required' }
    $OpenAction = { param($path) $Word.Documents.Open($path, $false, $true, $false) }.GetNewClosure()
  }
  if (-not $CopyAction) {
    $CopyAction = { param($source, $destination) Copy-Item -LiteralPath $source -Destination $destination }
  }

  try {
    $document = & $OpenAction $SourcePath
    return [pscustomobject]@{
      Document = $document
      TempPath = $null
      usedTempRecovery = $false
      recoveryReason = $null
      temporarySuffix = $null
    }
  } catch {
    $originalError = $_.Exception
  }

  $approvedReason = $Recovery -and $Recovery.reason -eq 'ole-compound-doc-with-docx-extension'
  $approvedSuffix = $Recovery -and $Recovery.temporarySuffix -eq '.doc'
  $verifiedMismatch = [IO.Path]::GetExtension($SourcePath) -ieq '.docx' -and
    (Test-GcOleCompoundSignature -SourcePath $SourcePath)
  if (-not ($approvedReason -and $approvedSuffix -and $verifiedMismatch)) {
    throw $originalError
  }

  $tempPath = Join-Path ([IO.Path]::GetTempPath()) (
    'tcm-gc-word-source-{0}{1}' -f [guid]::NewGuid().ToString('N'), $Recovery.temporarySuffix
  )
  & $CopyAction $SourcePath $tempPath
  try {
    $document = & $OpenAction $tempPath
    return [pscustomobject]@{
      Document = $document
      TempPath = $tempPath
      usedTempRecovery = $true
      recoveryReason = [string]$Recovery.reason
      temporarySuffix = [string]$Recovery.temporarySuffix
    }
  } catch {
    if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
    throw
  }
}
