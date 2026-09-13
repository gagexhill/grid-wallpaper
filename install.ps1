#requires -Version 5.1
<#
.SYNOPSIS
Installs Grid Wallpaper into Lively's library and opens it using Lively's display layout.
.DESCRIPTION
Uses the official WinGet package when Lively is missing. Existing Lively settings,
startup preferences, other library items, and per-display customization are preserved.
.PARAMETER Preview
Checks the package and describes the installation without changing files or apps.
.PARAMETER SkipLaunch
Installs the package without starting Lively or changing the active wallpaper.
.PARAMETER ReadyTimeoutSeconds
Maximum time to wait for Lively startup or its first-run setup before reporting
the remaining setup step. Complete that setup and rerun this command to continue.
#>
[CmdletBinding()]
param(
    [switch]$Preview,
    [switch]$SkipLaunch,
    [ValidateRange(5, 60)]
    [int]$ReadyTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$runtimeFiles = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'wallpaper-files.json') -Raw | ConvertFrom-Json
foreach ($file in $runtimeFiles) {
    if ($file -notmatch '^[A-Za-z0-9-]+\.(html|css|js|json)$') { throw 'Invalid runtime filename in wallpaper-files.json.' }
}
$packageId = 'rocksdanister.LivelyWallpaper'
$normalDataDirectory = Join-Path $env:LOCALAPPDATA 'Lively Wallpaper'

function Find-Lively {
    $candidates = @()
    $registryRoots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($registryRoot in $registryRoots) {
        if (-not (Test-Path -LiteralPath $registryRoot)) { continue }
        foreach ($entry in Get-ChildItem -LiteralPath $registryRoot) {
            $app = Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction SilentlyContinue
            if ($app -and $app.PSObject.Properties['DisplayName'] -and $app.DisplayName -eq 'Lively Wallpaper' -and
                $app.PSObject.Properties['InstallLocation'] -and $app.InstallLocation) {
                $candidates += Join-Path $app.InstallLocation 'Lively.exe'
            }
        }
    }
    $candidates += Join-Path $env:LOCALAPPDATA 'Programs\Lively Wallpaper\Lively.exe'
    if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles 'Lively Wallpaper\Lively.exe' }
    if (${env:ProgramFiles(x86)}) { $candidates += Join-Path ${env:ProgramFiles(x86)} 'Lively Wallpaper\Lively.exe' }
    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [pscustomobject]@{ Executable = $candidate; DataDirectory = $normalDataDirectory; Store = $false }
        }
    }
    if (Get-Command Get-AppxPackage -ErrorAction SilentlyContinue) {
        $storePackage = Get-AppxPackage -Name '12030rocksdanister.LivelyWallpaper' -ErrorAction Stop | Select-Object -First 1
        if ($storePackage) {
            $manifestPath = Join-Path $storePackage.InstallLocation 'AppxManifest.xml'
            [xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
            foreach ($application in $manifest.SelectNodes("//*[local-name()='Application']")) {
                $executable = $application.GetAttribute('Executable')
                if ([IO.Path]::GetFileName($executable) -ieq 'Lively.exe') {
                    $candidate = Join-Path $storePackage.InstallLocation $executable
                    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                        $storeData = Join-Path $env:LOCALAPPDATA ('Packages\' + $storePackage.PackageFamilyName + '\LocalCache\Local\Lively Wallpaper')
                        return [pscustomobject]@{ Executable = $candidate; DataDirectory = $storeData; Store = $true }
                    }
                }
            }
            throw 'The Microsoft Store installation was found, but its Lively executable could not be resolved. Repair Lively in Windows Settings, then rerun setup.'
        }
    }
    return $null
}

function Get-LivelyState($Lively) {
    $dataDirectory = if ($Lively) { $Lively.DataDirectory } else { $normalDataDirectory }
    $settingsPath = Join-Path $dataDirectory 'Settings.json'
    $libraryDirectory = Join-Path $normalDataDirectory 'Library'
    $firstRun = $true
    if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
        $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        if (-not $settings.PSObject.Properties['WallpaperDir'] -or [string]::IsNullOrWhiteSpace($settings.WallpaperDir)) {
            throw "Lively's Settings.json has no wallpaper library location. Open Lively and choose a library location before running setup."
        }
        $libraryDirectory = [string]$settings.WallpaperDir
        $firstRun = $settings.PSObject.Properties['IsFirstRun'] -and $settings.IsFirstRun
    }
    if (-not [IO.Path]::IsPathRooted($libraryDirectory)) {
        throw "Lively's wallpaper library must be an absolute path: $libraryDirectory"
    }
    $libraryDirectory = [IO.Path]::GetFullPath($libraryDirectory).TrimEnd('\')
    $commandDirectory = Join-Path $libraryDirectory 'wallpapers\grid-wallpaper'
    $destination = $commandDirectory
    if ($Lively -and $Lively.Store -and $destination.StartsWith($normalDataDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) {
        $destination = Join-Path $Lively.DataDirectory $destination.Substring($normalDataDirectory.Length + 1)
    }
    return [pscustomobject]@{
        Destination = $destination
        CommandDirectory = $commandDirectory
        FirstRun = [bool]$firstRun
        SettingsPath = $settingsPath
    }
}

function Assert-Destination($Destination, $Metadata) {
    if (-not (Test-Path -LiteralPath $Destination)) { return }
    $directory = Get-Item -LiteralPath $Destination
    if (-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "The target must be a regular directory: $Destination"
    }
    if (-not (Get-ChildItem -LiteralPath $Destination -Force | Select-Object -First 1)) { return }
    $metadataPath = Join-Path $Destination 'LivelyInfo.json'
    if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
        throw "The target contains files without Grid Wallpaper metadata. Nothing was overwritten: $Destination"
    }
    $installedMetadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    foreach ($field in @('Title', 'Author', 'FileName')) {
        if (-not $installedMetadata.PSObject.Properties[$field] -or $installedMetadata.$field -cne $Metadata.$field) {
            throw "A different wallpaper occupies the target. Nothing was overwritten: $Destination"
        }
    }
}

function Copy-Runtime($Destination) {
    foreach ($file in $runtimeFiles) {
        $targetPath = Join-Path $Destination $file
        if (Test-Path -LiteralPath $targetPath) {
            $target = Get-Item -LiteralPath $targetPath
            if ($target.PSIsContainer -or ($target.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw "A runtime target is not a regular file: $targetPath"
            }
        }
    }
    $null = New-Item -ItemType Directory -Path $Destination -Force
    foreach ($file in $runtimeFiles) {
        $sourcePath = Join-Path $PSScriptRoot $file
        $targetPath = Join-Path $Destination $file
        if ([IO.Path]::GetFullPath($sourcePath) -ieq [IO.Path]::GetFullPath($targetPath)) { continue }
        Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
        if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -cne (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash) {
            throw "Installed file verification failed: $file"
        }
    }
}

function Test-LivelyRunning($Executable) {
    foreach ($process in Get-Process -Name 'Lively' -ErrorAction SilentlyContinue) {
        if ($process.Path -and $process.Path -ieq $Executable) { return $true }
    }
    return $false
}

try {
    if ($env:OS -ne 'Windows_NT') { throw 'Desktop installation requires Windows. Open grid-wallpaper.html in a browser to preview on other systems.' }
    foreach ($file in $runtimeFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $file) -PathType Leaf)) {
            throw "The package is incomplete: $file is missing. Extract the complete release ZIP before running setup."
        }
    }
    $metadata = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'LivelyInfo.json') -Raw | ConvertFrom-Json
    $null = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'LivelyProperties.json') -Raw | ConvertFrom-Json
    $lively = Find-Lively
    $state = Get-LivelyState $lively
    Assert-Destination $state.Destination $metadata
    if ($Preview) {
        Write-Output 'Preview only: no files, applications, wallpaper, or settings were changed.'
        if ($lively) { Write-Output ('Lively: ' + $lively.Executable) }
        else { Write-Output ('Would install with WinGet: ' + $packageId + ' (official stable package).') }
        Write-Output ('Would copy ' + $runtimeFiles.Count + ' runtime files to: ' + $state.Destination)
        if (-not $SkipLaunch) { Write-Output ('Would open Lively and submit: setwp --file "' + $state.CommandDirectory + '"') }
        return
    }
    if (-not $lively) {
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if (-not $winget) {
            throw 'WinGet is missing. Install Microsoft App Installer from https://aka.ms/getwinget, then rerun this command. Alternatively install Lively from https://www.rocksdanister.com/lively/.'
        }
        Write-Output 'Installing Lively Wallpaper through WinGet. Its installer manages required Microsoft runtimes.'
        & $winget.Source install --id $packageId --exact --source winget --silent --disable-interactivity --accept-package-agreements --accept-source-agreements --custom '/NOAUTOLAUNCH'
        $installExit = $LASTEXITCODE
        if ($installExit -ne 0) { throw "WinGet exited with code $installExit. Resolve the reported installation error and rerun setup." }
        $lively = Find-Lively
        if (-not $lively) { throw 'WinGet finished, but Lively was not found. Open Lively once from Start, then rerun setup.' }
        $state = Get-LivelyState $lively
        Assert-Destination $state.Destination $metadata
    }
    Copy-Runtime $state.Destination
    Write-Output ('Grid Wallpaper files installed and verified: ' + $state.Destination)
    if ($SkipLaunch) {
        Write-Output 'Launch skipped. Rerun without -SkipLaunch to open the wallpaper. Lively owns customization and removal through its library.'
        return
    }
    if (-not (Test-LivelyRunning $lively.Executable) -or $state.FirstRun) {
        if ($state.FirstRun) { Write-Output 'Complete the Lively setup window. Choose your startup and battery preferences there.' }
        $null = Start-Process -FilePath $lively.Executable -ArgumentList 'app --showApp true' -WindowStyle Hidden -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
        do {
            Start-Sleep -Milliseconds 500
            $state = Get-LivelyState $lively
            $ready = (Test-LivelyRunning $lively.Executable) -and -not $state.FirstRun
        } while (-not $ready -and [DateTime]::UtcNow -lt $deadline)
        if (-not $ready) {
            Write-Warning 'The wallpaper files are installed. Complete or open Lively, then rerun this command to apply them. Desktop rendering has not been verified.'
            exit 2
        }
        Assert-Destination $state.Destination $metadata
        Copy-Runtime $state.Destination
    }
    $arguments = 'setwp --file "' + $state.CommandDirectory + '"'
    $command = Start-Process -FilePath $lively.Executable -ArgumentList $arguments -WindowStyle Hidden -PassThru
    if (-not $command.WaitForExit(10000)) {
        throw 'Lively did not finish accepting the command within 10 seconds. Check its window and logs before rerunning setup; its processes were left running.'
    }
    if ($command.ExitCode -ne 0) { throw "Lively exited with code $($command.ExitCode) while accepting the wallpaper command." }
    Write-Output 'Submitted Grid Wallpaper to Lively. Confirm the animated grid on your desktop; this command alone cannot verify rendering.'
    Write-Output 'Use Lively Library > Grid Wallpaper > Customize for settings that survive restart. Startup, battery pause, displays, and removal are managed in Lively.'
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}
