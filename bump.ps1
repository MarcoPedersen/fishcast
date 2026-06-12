# Bumps the FishCast cache version in index.html and sw.js in one go.
# Usage: .\bump.ps1          (increments by 1)
#        .\bump.ps1 -To 60   (sets a specific version)
param([int]$To = 0)

$root = $PSScriptRoot
$sw   = Join-Path $root 'sw.js'
$html = Join-Path $root 'index.html'

# Read/write as UTF-8 explicitly — PS 5.1 otherwise reads BOM-less UTF-8 as ANSI and corrupts non-ASCII chars
$utf8 = New-Object System.Text.UTF8Encoding($false)
$swText = [IO.File]::ReadAllText($sw, $utf8)
if ($swText -notmatch "fishcast-v(\d+)") { throw "Could not find fishcast-vNN in sw.js" }
$cur  = [int]$Matches[1]
$next = if ($To -gt 0) { $To } else { $cur + 1 }

$swText = $swText -replace "fishcast-v$cur", "fishcast-v$next" -replace "\?v=$cur", "?v=$next"
$htmlText = [IO.File]::ReadAllText($html, $utf8) -replace "\?v=$cur", "?v=$next"

[IO.File]::WriteAllText($sw, $swText, $utf8)
[IO.File]::WriteAllText($html, $htmlText, $utf8)
Write-Host "Bumped v$cur -> v$next (sw.js + index.html)"
