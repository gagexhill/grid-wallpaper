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
    $sourceDirectory = if ($file -in $runtimeFiles -and $file -match '\.(exe|dll|txt)$') { Join-Path $root 'dist\settings-host' }
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
Compress-Archive -LiteralPath $paths -DestinationPath $zip -Force
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $destination 'grid-wallpaper-windows.zip.sha256'), "$hash  grid-wallpaper-windows.zip`n")
Write-Output "Created $zip"
Write-Output "SHA256 $hash"
