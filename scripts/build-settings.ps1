#requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# The official SDK is build-only. The receiving laptop uses its installed WebView2 Runtime.
$sdkVersion = '1.0.4191.47'
$sdkSha512 = 'rfkb2hpx2GDAmM0OQmtaI44Yfqc8aUgy+P3jaAmpFl/aiET8nCufyKhwsNpTzZ65fsFA2aLxBKIoMB/66EHbjA=='

# The Windows .NET Framework compiler stamps a timestamp and a fresh assembly identity
# into every build, so identical source produced a different helper each time and no
# recorded release digest could be reproduced, even on this machine. Microsoft's official
# Roslyn toolset is also build-only, hosts on .NET Framework, and compiles deterministically.
$compilerVersion = '5.9.0'
$compilerSha512 = 'nueMs8iTpdfM4+tbhcqHbPI2DHQ7NMqVx3n1xAecnITF5iB3HtR5H40kfq0DLbI0/QgckG/dw30LeIdojmYa4Q=='
$projectDirectory = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$distDirectory = Join-Path $projectDirectory 'dist'
$sdkDirectory = Join-Path $distDirectory 'native-sdk'
$compilerDirectory = Join-Path $distDirectory 'native-compiler'
$outputDirectory = Join-Path $distDirectory 'settings-host'
$frameworkDirectory = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
if (-not (Test-Path -LiteralPath $frameworkDirectory -PathType Container)) {
    throw 'The installed .NET Framework reference assemblies are required to build the settings window.'
}

foreach ($directory in @($distDirectory, $sdkDirectory, $compilerDirectory, $outputDirectory)) {
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

# Both build-only dependencies are pinned by exact version and SHA512, resolved through
# NuGet's signed catalog, and cached under dist/. Neither is redistributed.
function Resolve-PinnedNuGetPackage([string] $Id, [string] $Version, [string] $Sha512, [string] $CacheDirectory) {
    $lowerId = $Id.ToLowerInvariant()
    $packageName = "$lowerId.$Version.nupkg"
    $packagePath = Join-Path $CacheDirectory $packageName
    if (Test-Path -LiteralPath $packagePath) {
        if ((Get-Item -LiteralPath $packagePath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "The $Id cache must not be a link." }
        if ((Get-PackageSha512 $packagePath) -cne $Sha512) { throw "The cached $Id package failed integrity verification. Remove that cache file and retry." }
        return $packagePath
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $registrationUri = "https://api.nuget.org/v3/registration5-gz-semver2/$lowerId/$Version.json"
    $registration = Invoke-RestMethod -Uri $registrationUri -UseBasicParsing
    $catalogUri = [Uri]$registration.catalogEntry
    if ($catalogUri.Scheme -ne 'https' -or $catalogUri.Host -ne 'api.nuget.org' -or -not $catalogUri.AbsolutePath.StartsWith('/v3/catalog0/', [StringComparison]::Ordinal)) {
        throw "NuGet returned an unexpected metadata location for $Id."
    }
    $catalog = Invoke-RestMethod -Uri $catalogUri.AbsoluteUri -UseBasicParsing
    if ($catalog.id -cne $Id -or $catalog.version -cne $Version -or $catalog.packageHashAlgorithm -cne 'SHA512' -or $catalog.packageHash -cne $Sha512) {
        throw "The published $Id metadata does not match the pinned dependency."
    }
    $downloadPath = Join-Path $CacheDirectory ($packageName + '.download')
    if ((Test-Path -LiteralPath $downloadPath) -and ((Get-Item -LiteralPath $downloadPath).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "The $Id download must not be a link." }
    try {
        Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/$lowerId/$Version/$packageName" -OutFile $downloadPath -UseBasicParsing
        if ((Get-PackageSha512 $downloadPath) -cne $Sha512) { throw "The downloaded $Id package failed SHA512 integrity verification." }
        Move-Item -LiteralPath $downloadPath -Destination $packagePath -Force
    }
    finally { if (Test-Path -LiteralPath $downloadPath -PathType Leaf) { Remove-Item -LiteralPath $downloadPath -Force } }
    $packagePath
}

function ConvertTo-CSharpString([string] $Value) {
    $literal = New-Object Text.StringBuilder
    $null = $literal.Append('"')
    foreach ($character in $Value.ToCharArray()) {
        $code = [int]$character
        if ($code -eq 34) { $null = $literal.Append('\"') }
        elseif ($code -eq 92) { $null = $literal.Append('\\') }
        elseif ($code -lt 32 -or $code -gt 126) { $null = $literal.Append(('\u{0:x4}' -f $code)) }
        else { $null = $literal.Append($character) }
    }
    $null = $literal.Append('"')
    $literal.ToString()
}

$packageMetadata = Get-Content -LiteralPath (Join-Path $projectDirectory 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$wallpaperMetadata = Get-Content -LiteralPath (Join-Path $projectDirectory 'wallpaper\LivelyInfo.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($value in @($packageMetadata.version, $packageMetadata.description, $wallpaperMetadata.Title, $wallpaperMetadata.Author)) {
    if ($value -isnot [string] -or [string]::IsNullOrWhiteSpace($value) -or $value.Contains([string][char]0)) {
        throw 'Native product metadata must contain nonempty strings without null characters.'
    }
}
$versionMatch = [regex]::Match($packageMetadata.version, '^(?<major>0|[1-9][0-9]*)\.(?<minor>0|[1-9][0-9]*)\.(?<patch>0|[1-9][0-9]*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$')
if (-not $versionMatch.Success -or @($versionMatch.Groups['pre'].Value.Split('.') | Where-Object { $_ -match '^0[0-9]+$' }).Count -gt 0) {
    throw 'The package version must be a semantic version.'
}
$versionParts = foreach ($part in @('major', 'minor', 'patch')) {
    $component = 0
    if (-not [int]::TryParse($versionMatch.Groups[$part].Value, [ref]$component) -or $component -gt 65534) {
        throw 'Native version components must be between 0 and 65534.'
    }
    $component
}
# Prerelease/build identifiers remain in ProductVersion; native numeric versions use revision zero.
$numericVersion = ($versionParts -join '.') + '.0'
$assemblyAttributes = [ordered]@{
    AssemblyTitle = $wallpaperMetadata.Title
    AssemblyProduct = $wallpaperMetadata.Title
    AssemblyCompany = $wallpaperMetadata.Author
    AssemblyDescription = $packageMetadata.description
    AssemblyVersion = $numericVersion
    AssemblyFileVersion = $numericVersion
    AssemblyInformationalVersion = $packageMetadata.version
}
$assemblyInfoPath = Join-Path $distDirectory 'native-assembly-info.cs'
if ((Test-Path -LiteralPath $assemblyInfoPath) -and ((Get-Item -LiteralPath $assemblyInfoPath).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Generated native metadata must not be a link.' }
$assemblyInfo = foreach ($attribute in $assemblyAttributes.Keys) {
    '[assembly: System.Reflection.' + $attribute + '(' + (ConvertTo-CSharpString $assemblyAttributes[$attribute]) + ')]'
}
[IO.File]::WriteAllLines($assemblyInfoPath, [string[]]$assemblyInfo, (New-Object Text.UTF8Encoding($false)))

$packagePath = Resolve-PinnedNuGetPackage -Id 'Microsoft.Web.WebView2' -Version $sdkVersion -Sha512 $sdkSha512 -CacheDirectory $sdkDirectory

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

# Extract the compiler host beside its own dependencies. Only the files that sit directly
# in the host folder are needed; the localized resource subfolders are skipped.
$compilerPackagePath = Resolve-PinnedNuGetPackage -Id 'Microsoft.Net.Compilers.Toolset' -Version $compilerVersion -Sha512 $compilerSha512 -CacheDirectory $compilerDirectory
$compiler = Join-Path $compilerDirectory 'csc.exe'
$compilerArchive = [IO.Compression.ZipFile]::OpenRead($compilerPackagePath)
try {
    $hostPrefix = 'tasks/net472/'
    $hostEntries = @($compilerArchive.Entries | Where-Object {
        $_.FullName.StartsWith($hostPrefix, [StringComparison]::Ordinal) -and
        $_.Name -and
        -not $_.FullName.Substring($hostPrefix.Length).Contains('/')
    })
    if ($hostEntries.Count -lt 1) { throw 'The pinned compiler package is missing its .NET Framework host.' }
    foreach ($entry in $hostEntries) {
        $target = Join-Path $compilerDirectory $entry.Name
        if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Compiler files must not be links.' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
}
finally { $compilerArchive.Dispose() }
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'The pinned C# compiler was not extracted.' }

$executablePath = Join-Path $outputDirectory 'grid-settings.exe'
if ((Test-Path -LiteralPath $executablePath) -and ((Get-Item -LiteralPath $executablePath).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The settings executable output must not be a link.' }
$references = @('System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll', 'System.Management.dll')
# /deterministic makes the compiled bytes a function of the inputs alone, and /pathmap keeps
# this checkout's absolute path out of them, so an identical source tree rebuilds to an
# identical helper and a recorded release digest can be verified rather than merely recorded.
# Determinism also depends on the output filename, which is fixed here.
$compilerArguments = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/debug-', '/deterministic', '/utf8output', "/pathmap:$projectDirectory=/_/", "/out:$executablePath")
foreach ($reference in $references) { $compilerArguments += '/reference:' + (Join-Path $frameworkDirectory $reference) }
$compilerArguments += '/reference:' + (Join-Path $outputDirectory 'Microsoft.Web.WebView2.Core.dll')
$compilerArguments += '/reference:' + (Join-Path $outputDirectory 'Microsoft.Web.WebView2.WinForms.dll')
$compilerArguments += Join-Path $projectDirectory 'windows\settings-window.cs'
$compilerArguments += Join-Path $projectDirectory 'windows\dome-telemetry.cs'
$compilerArguments += Join-Path $projectDirectory 'windows\wallpaper-lifecycle.cs'
$compilerArguments += $assemblyInfoPath
& $compiler @compilerArguments
if ($LASTEXITCODE -ne 0) { throw "The native settings compiler failed with exit code $LASTEXITCODE." }
$fileMetadata = [Diagnostics.FileVersionInfo]::GetVersionInfo($executablePath)
$expectedMetadata = [ordered]@{
    ProductName = $wallpaperMetadata.Title
    CompanyName = $wallpaperMetadata.Author
    FileDescription = $wallpaperMetadata.Title
    Comments = $packageMetadata.description
    ProductVersion = $packageMetadata.version
    FileVersion = $numericVersion
}
foreach ($property in $expectedMetadata.Keys) {
    if ($fileMetadata.$property -cne $expectedMetadata[$property]) { throw "The native executable metadata failed readback verification: $property." }
}
if ([Reflection.AssemblyName]::GetAssemblyName($executablePath).Version.ToString() -cne $numericVersion) { throw 'The native assembly version failed readback verification.' }
Write-Output "Built $executablePath using Microsoft.Web.WebView2 $sdkVersion."
Write-Output "Verified native metadata: $($fileMetadata.ProductName), $($fileMetadata.CompanyName), product $($fileMetadata.ProductVersion), file/assembly $numericVersion."
