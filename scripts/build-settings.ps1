#requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# The official SDK is build-only. The receiving laptop uses its installed WebView2 Runtime.
$sdkVersion = '1.0.4191.47'
$sdkSha512 = 'rfkb2hpx2GDAmM0OQmtaI44Yfqc8aUgy+P3jaAmpFl/aiET8nCufyKhwsNpTzZ65fsFA2aLxBKIoMB/66EHbjA=='
$projectDirectory = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$distDirectory = Join-Path $projectDirectory 'dist'
$sdkDirectory = Join-Path $distDirectory 'native-sdk'
$outputDirectory = Join-Path $distDirectory 'settings-host'
$frameworkDirectory = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $frameworkDirectory 'csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
    throw 'The Windows .NET Framework C# compiler is required to build the settings window.'
}

foreach ($directory in @($distDirectory, $sdkDirectory, $outputDirectory)) {
    $absoluteDirectory = [IO.Path]::GetFullPath($directory)
    if (-not $absoluteDirectory.StartsWith($projectDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Native build output must stay inside this checkout.'
    }
    if ((Test-Path -LiteralPath $directory) -and ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Native build directories must not be links.'
    }
    $null = New-Item -ItemType Directory -Path $directory -Force
}

function Get-PackageSha512([string] $Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA512]::Create()
    try { [Convert]::ToBase64String($algorithm.ComputeHash($stream)) }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

$packageName = "microsoft.web.webview2.$sdkVersion.nupkg"
$packagePath = Join-Path $sdkDirectory $packageName
if (Test-Path -LiteralPath $packagePath) {
    if ((Get-Item -LiteralPath $packagePath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The SDK cache must not be a link.' }
    if ((Get-PackageSha512 $packagePath) -cne $sdkSha512) { throw 'The cached WebView2 SDK failed integrity verification. Remove that cache file and retry.' }
}
else {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $registrationUri = "https://api.nuget.org/v3/registration5-gz-semver2/microsoft.web.webview2/$sdkVersion.json"
    $registration = Invoke-RestMethod -Uri $registrationUri -UseBasicParsing
    $catalogUri = [Uri]$registration.catalogEntry
    if ($catalogUri.Scheme -ne 'https' -or $catalogUri.Host -ne 'api.nuget.org' -or -not $catalogUri.AbsolutePath.StartsWith('/v3/catalog0/', [StringComparison]::Ordinal)) {
        throw 'NuGet returned an unexpected SDK metadata location.'
    }
    $catalog = Invoke-RestMethod -Uri $catalogUri.AbsoluteUri -UseBasicParsing
    if ($catalog.id -cne 'Microsoft.Web.WebView2' -or $catalog.version -cne $sdkVersion -or $catalog.packageHashAlgorithm -cne 'SHA512' -or $catalog.packageHash -cne $sdkSha512) {
        throw 'The published WebView2 SDK metadata does not match the pinned dependency.'
    }
    $downloadPath = Join-Path $sdkDirectory ($packageName + '.download')
    if ((Test-Path -LiteralPath $downloadPath) -and ((Get-Item -LiteralPath $downloadPath).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The SDK download must not be a link.' }
    try {
        Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/$packageName" -OutFile $downloadPath -UseBasicParsing
        if ((Get-PackageSha512 $downloadPath) -cne $sdkSha512) { throw 'The downloaded WebView2 SDK failed SHA512 integrity verification.' }
        Move-Item -LiteralPath $downloadPath -Destination $packagePath -Force
    }
    finally { if (Test-Path -LiteralPath $downloadPath -PathType Leaf) { Remove-Item -LiteralPath $downloadPath -Force } }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($packagePath)
try {
    $redistributables = [ordered]@{
        'lib/net462/Microsoft.Web.WebView2.Core.dll' = 'Microsoft.Web.WebView2.Core.dll'
        'lib/net462/Microsoft.Web.WebView2.WinForms.dll' = 'Microsoft.Web.WebView2.WinForms.dll'
        'runtimes/win-x64/native/WebView2Loader.dll' = 'WebView2Loader.dll'
        'LICENSE.txt' = 'webview2-license.txt'
    }
    foreach ($entryName in $redistributables.Keys) {
        $entry = $archive.GetEntry($entryName)
        if ($null -eq $entry) { throw "The pinned SDK is missing its required distribution file: $entryName" }
        $target = Join-Path $outputDirectory $redistributables[$entryName]
        if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Build output files must not be links.' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
    $vendorNotices = @($archive.Entries | Where-Object { $_.Name -match '(?i)(third.?party|notices)' })
    if ($vendorNotices.Count -gt 0) { throw 'The SDK includes additional vendor notices. Review redistribution requirements before packaging.' }
}
finally { $archive.Dispose() }

$executablePath = Join-Path $outputDirectory 'grid-settings.exe'
if ((Test-Path -LiteralPath $executablePath) -and ((Get-Item -LiteralPath $executablePath).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The settings executable output must not be a link.' }
$references = @('System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll')
$compilerArguments = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/debug-', '/utf8output', "/out:$executablePath")
foreach ($reference in $references) { $compilerArguments += '/reference:' + (Join-Path $frameworkDirectory $reference) }
$compilerArguments += '/reference:' + (Join-Path $outputDirectory 'Microsoft.Web.WebView2.Core.dll')
$compilerArguments += '/reference:' + (Join-Path $outputDirectory 'Microsoft.Web.WebView2.WinForms.dll')
$compilerArguments += Join-Path $projectDirectory 'windows\settings-window.cs'
& $compiler @compilerArguments
if ($LASTEXITCODE -ne 0) { throw "The native settings compiler failed with exit code $LASTEXITCODE." }
Write-Output "Built $executablePath using Microsoft.Web.WebView2 $sdkVersion."
