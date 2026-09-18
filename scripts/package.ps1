#requires -Version 5.1
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'build-settings.ps1')
$manifest = Join-Path $root 'wallpaper-files.json'
$runtimeFiles = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
$files = $runtimeFiles + @('wallpaper-files.json', 'install.ps1', 'README.md', 'OPERATIONS.md')
$paths = foreach ($file in $files) {
    if ($file -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*\.(html|css|js|json|jpg|gif|ps1|md|exe|dll|txt)$') { throw 'Package entries must be root filenames.' }
    $sourceDirectory = if ($file -eq 'LICENSE.txt') { $root }
        elseif ($file -in $runtimeFiles -and $file -match '\.(exe|dll|txt)$') { Join-Path $root 'dist\settings-host' }
        elseif ($file -in $runtimeFiles) { Join-Path $root 'wallpaper' }
        else { $root }
    if ((Get-Item -LiteralPath $sourceDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package source directories must not be links.' }
    $path = Join-Path $sourceDirectory $file
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Package file is missing: $file" }
    if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Package source must not be a link: $file" }
    $path
}
$destination = Join-Path $root 'dist'
$null = New-Item -ItemType Directory -Path $destination -Force
$zip = Join-Path $destination 'grid-wallpaper-windows.zip'
# Compress-Archive stores each entry's real last-write time, so the archive hash
# changed on every rebuild even when nothing changed. Write the entries in a fixed
# ordinal order with the ZIP format's earliest representable timestamp instead, so
# the recorded release SHA256 is reproducible from the same source tree.
Add-Type -AssemblyName System.IO.Compression
# A default hashtable compares keys case-insensitively, which is what a Windows
# package needs: two entries differing only by case would collide on extraction,
# so rejecting them here is deliberate rather than an oversight.
$entryPaths = @{}
foreach ($path in $paths) {
    $entryName = [IO.Path]::GetFileName($path)
    if ($entryPaths.ContainsKey($entryName)) { throw "Package entries must be unique: $entryName" }
    $entryPaths[$entryName] = $path
}
$entryNames = [string[]]$entryPaths.Keys
[Array]::Sort($entryNames, [StringComparer]::Ordinal)
$fixedTimestamp = New-Object DateTimeOffset(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
# Write to a temporary file first. A run that fails partway through then leaves no
# archive at all, rather than a truncated one that looks like a build output.
$partialZip = "$zip.partial"
$zipStream = [IO.File]::Open($partialZip, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
    $archive = New-Object IO.Compression.ZipArchive($zipStream, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($entryName in $entryNames) {
            $entry = $archive.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = $fixedTimestamp
            $entryStream = $entry.Open()
            try {
                $bytes = [IO.File]::ReadAllBytes($entryPaths[$entryName])
                $entryStream.Write($bytes, 0, $bytes.Length)
            }
            finally { $entryStream.Dispose() }
        }
    }
    finally { $archive.Dispose() }
}
finally { $zipStream.Dispose() }
Move-Item -LiteralPath $partialZip -Destination $zip -Force
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $destination 'grid-wallpaper-windows.zip.sha256'), "$hash  grid-wallpaper-windows.zip`n")
Write-Output "Created $zip"
Write-Output "SHA256 $hash"
