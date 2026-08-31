$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $root 'tools\gc_word_open_recovery.ps1'
if (-not (Test-Path -LiteralPath $helper)) { throw 'gc_word_open_recovery.ps1 is required' }
. $helper

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('gc-word-recovery-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
  $olePath = Join-Path $tempRoot 'known-mismatch.docx'
  [IO.File]::WriteAllBytes($olePath, [byte[]](0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1,1,2,3))
  $zipPath = Join-Path $tempRoot 'ordinary.docx'
  [IO.File]::WriteAllBytes($zipPath, [byte[]](0x50,0x4B,0x03,0x04,1,2,3,4))
  $recovery = [pscustomobject]@{ reason = 'ole-compound-doc-with-docx-extension'; temporarySuffix = '.doc' }

  $opens = 0; $copies = 0
  $result = Open-GcWordDocumentReadOnly -SourcePath $olePath -Recovery $recovery `
    -OpenAction { param($path) $script:opens++; if ($script:opens -eq 1) { throw 'format mismatch' }; return "opened:$path" } `
    -CopyAction { param($source,$destination) $script:copies++; Copy-Item -LiteralPath $source -Destination $destination }
  if (-not $result.usedTempRecovery -or $result.recoveryReason -ne $recovery.reason -or $result.temporarySuffix -ne '.doc') {
    throw 'known reviewed mismatch did not report exact recovery provenance'
  }
  if ($opens -ne 2 -or $copies -ne 1) { throw "known mismatch expected 2 opens/1 copy, got $opens/$copies" }
  if (-not $result.TempPath.EndsWith('.doc')) { throw 'recovery copy suffix must be .doc' }
  Remove-Item -LiteralPath $result.TempPath -Force

  $opens = 0; $copies = 0
  try {
    Open-GcWordDocumentReadOnly -SourcePath $zipPath -Recovery $null `
      -OpenAction { param($path) $script:opens++; throw 'permission denied sentinel' } `
      -CopyAction { param($source,$destination) $script:copies++ } | Out-Null
    throw 'unrelated open failure was swallowed'
  } catch {
    if ($_.Exception.Message -ne 'permission denied sentinel') { throw }
  }
  if ($opens -ne 1 -or $copies -ne 0) { throw "unrelated failure must not copy/retry, got $opens/$copies" }

  $opens = 0; $copies = 0
  try {
    Open-GcWordDocumentReadOnly -SourcePath $zipPath -Recovery $recovery `
      -OpenAction { param($path) $script:opens++; throw 'corrupt ordinary docx sentinel' } `
      -CopyAction { param($source,$destination) $script:copies++ } | Out-Null
    throw 'signature mismatch was swallowed'
  } catch {
    if ($_.Exception.Message -ne 'corrupt ordinary docx sentinel') { throw }
  }
  if ($opens -ne 1 -or $copies -ne 0) { throw "unverified signature must not copy/retry, got $opens/$copies" }
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force
}

Write-Host 'PASS: temp .doc recovery is manifest- and signature-gated; unrelated failures rethrow unchanged'
