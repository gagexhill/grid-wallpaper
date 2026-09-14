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
.PARAMETER RemoveSettingsLink
Removes the per-user settings link and warm-start entry without deleting wallpapers or Lively.
.PARAMETER ReadyTimeoutSeconds
Maximum time to wait for Lively startup or its first-run setup before reporting
the remaining setup step. Complete that setup and rerun this command to continue.
#>
[CmdletBinding()]
param(
    [switch]$Preview,
    [switch]$SkipLaunch,
    [switch]$RemoveSettingsLink,
    [ValidateRange(5, 60)]
    [int]$ReadyTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$runtimeFiles = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'wallpaper-files.json') -Raw | ConvertFrom-Json
foreach ($file in $runtimeFiles) {
    if ($file -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*\.(html|css|js|json|jpg|gif|exe|dll|txt)$') { throw 'Invalid runtime filename in wallpaper-files.json.' }
}
$packageId = 'rocksdanister.LivelyWallpaper'
$normalDataDirectory = Join-Path $env:LOCALAPPDATA 'Lively Wallpaper'
function Get-RuntimeSource($File) {
    $sourcePath = Join-Path $PSScriptRoot $File
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        $sourceDirectory = Join-Path $PSScriptRoot 'wallpaper'
        if ((Test-Path -LiteralPath $sourceDirectory) -and
            ((Get-Item -LiteralPath $sourceDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Runtime source directories must not be links.'
        }
        $sourcePath = Join-Path $sourceDirectory $File
    }
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        $sourcePath = Join-Path (Join-Path $PSScriptRoot 'dist\settings-host') $File
    }
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "The package is incomplete: $File is missing. Extract the complete ZIP, or build the settings host when developing from source." }
    if ((Get-Item -LiteralPath $sourcePath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Runtime sources must be regular files: $File" }
    return $sourcePath
}

$integration = Get-Content -LiteralPath (Get-RuntimeSource 'windows-integration.json') -Raw | ConvertFrom-Json
if ($integration.settingsUri -notmatch '^[a-z][a-z0-9-]{2,50}:$') { throw 'Invalid settings link metadata.' }
$settingsKey = 'HKCU:\Software\Classes\' + $integration.settingsUri.TrimEnd(':')
$startupKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupName = 'GridWallpaperSettings'

function Assert-SettingsLink {
    if (Test-Path -LiteralPath $settingsKey) {
        if ((Get-Item -LiteralPath $settingsKey).GetValue('GridWallpaperManaged', 0) -ne 1) { throw 'The settings link is owned by another application. Nothing was overwritten.' }
    } elseif (Test-Path -LiteralPath ('Registry::HKEY_CLASSES_ROOT\' + $integration.settingsUri.TrimEnd(':'))) {
        throw 'The settings link is already registered by another application. Nothing was overwritten.'
    }
    if (Test-Path -LiteralPath $startupKey) {
        $startupValue = (Get-Item -LiteralPath $startupKey).GetValue($startupName, $null)
        if ($null -ne $startupValue -and (-not (Test-Path -LiteralPath $settingsKey) -or
            (Get-Item -LiteralPath $settingsKey).GetValue('GridWallpaperWarmStartManaged', 0) -ne 1)) {
            throw 'The settings startup entry is owned by another application. Nothing was overwritten.'
        }
    }
}

function Register-SettingsLink($Destination) {
    Assert-SettingsLink
    $executable = Join-Path $Destination 'grid-settings.exe'
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'The settings host is missing. Extract the complete package and rerun setup.' }
    $commandKey = Join-Path $settingsKey 'shell\open\command'
    $null = New-Item -Path $commandKey -Force
    $null = New-ItemProperty -LiteralPath $settingsKey -Name '(default)' -Value 'URL:Grid Wallpaper Settings' -PropertyType String -Force
    $null = New-ItemProperty -LiteralPath $settingsKey -Name 'URL Protocol' -Value '' -PropertyType String -Force
    $null = New-ItemProperty -LiteralPath $settingsKey -Name 'GridWallpaperManaged' -Value 1 -PropertyType DWord -Force
    $command = '"' + $executable + '" --uri "%1"'
    $null = New-ItemProperty -LiteralPath $commandKey -Name '(default)' -Value $command -PropertyType String -Force
    if ((Get-Item -LiteralPath $commandKey).GetValue('') -cne $command) { throw 'Settings link verification failed.' }
    if (-not (Test-Path -LiteralPath $startupKey)) { $null = New-Item -Path $startupKey }
    $null = New-ItemProperty -LiteralPath $settingsKey -Name 'GridWallpaperWarmStartManaged' -Value 1 -PropertyType DWord -Force
    $warmCommand = '"' + $executable + '" --warm'
    $null = New-ItemProperty -LiteralPath $startupKey -Name $startupName -Value $warmCommand -PropertyType String -Force
    if ((Get-Item -LiteralPath $startupKey).GetValue($startupName) -cne $warmCommand) { throw 'Settings warm-start verification failed.' }
}

function Remove-SettingsLink {
    if (-not (Test-Path -LiteralPath $settingsKey)) { return }
    Assert-SettingsLink
    if ((Test-Path -LiteralPath $startupKey) -and $null -ne (Get-Item -LiteralPath $startupKey).GetValue($startupName, $null)) {
        Remove-ItemProperty -LiteralPath $startupKey -Name $startupName -ErrorAction Stop
    }
    if ((Get-Item -LiteralPath $settingsKey).Name -cne $settingsKey.Replace('HKCU:', 'HKEY_CURRENT_USER')) { throw 'Refusing to remove a registration outside the exact owned key.' }
    Remove-Item -LiteralPath $settingsKey -Recurse -Force
}

function Assert-HostConfig($Destination) {
    $configPath = Join-Path $Destination 'windows-host.json'
    if (Test-Path -LiteralPath $configPath) {
        $existing = Get-Item -LiteralPath $configPath
        if ($existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The installed settings configuration must be a regular file.' }
    }
}

function Write-HostConfig($Destination, $Lively) {
    Assert-HostConfig $Destination
    $configPath = Join-Path $Destination 'windows-host.json'
    $config = @{ LivelyExecutable = $Lively.Executable; LivelyDataDirectory = $Lively.DataDirectory; WallpaperDirectory = $Destination }
    [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json))
}

function Close-SettingsHost($Destination) {
    $executable = Join-Path $Destination 'grid-settings.exe'
    $running = @(Get-Process -Name 'grid-settings' -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq $executable })
    if (-not $running.Count) { return }
    $command = Start-Process -FilePath $executable -ArgumentList '--close' -WindowStyle Hidden -PassThru
    if (-not $command.WaitForExit(18000) -or $command.ExitCode -ne 0) { throw 'Close Grid settings, allow pending changes to save, and rerun setup. No settings process was force-stopped.' }
    if (@($running | Where-Object { -not $_.HasExited }).Count) { throw 'Grid settings is still closing. Rerun setup after its window closes.' }
}

function Warm-SettingsHost($Destination) {
    $executable = Join-Path $Destination 'grid-settings.exe'
    $null = Start-Process -FilePath $executable -ArgumentList '--warm' -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = $executable
        $start.Arguments = '--status'
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $probe = [Diagnostics.Process]::Start($start)
        try {
            if (-not $probe.WaitForExit(2000)) { break }
            if ($probe.ExitCode -eq 0) {
                $status = $probe.StandardOutput.ReadToEnd() | ConvertFrom-Json
                if ($status.running -and $status.ready) { Write-Output 'Grid settings is ready for quick opening.'; return }
            }
        } finally { $probe.Dispose() }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    Write-Warning 'The settings panel is still preparing. If it does not open, confirm Grid Wallpaper is active on the primary display with Lively''s WebView2 player.'
}

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
            if ($app -and $app.PSObject.Properties['DisplayName'] -and $app.DisplayName -match '^Lively Wallpaper(?: version [0-9.]+)?$' -and
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

function Get-LivelyState($Lively, [switch]$AllowInitializing) {
    $dataDirectory = if ($Lively) { $Lively.DataDirectory } else { $normalDataDirectory }
    $settingsPath = Join-Path $dataDirectory 'Settings.json'
    $libraryDirectory = Join-Path $normalDataDirectory 'Library'
    $firstRun = $true
    $settingsReady = $false
    if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
        try {
            $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
            if (-not $settings -or -not $settings.PSObject.Properties['WallpaperDir'] -or [string]::IsNullOrWhiteSpace($settings.WallpaperDir)) {
                throw "Lively's Settings.json has no wallpaper library location. Open Lively and choose a library location before running setup."
            }
            $libraryDirectory = [string]$settings.WallpaperDir
            $firstRun = $settings.PSObject.Properties['IsFirstRun'] -and $settings.IsFirstRun
            $settingsReady = $true
        } catch {
            if (-not $AllowInitializing) { throw }
        }
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
        SettingsReady = $settingsReady
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
        $sourcePath = Get-RuntimeSource $file
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

function Get-LivelyUiPath($Lively) {
    $coreDirectory = Split-Path $Lively.Executable -Parent
    if ($Lively.Store) { return Join-Path (Split-Path $coreDirectory -Parent) 'Lively.UI.WinUI.exe' }
    return Join-Path $coreDirectory 'Plugins\UI\Lively.UI.WinUI.exe'
}

function Invoke-LivelyCommand([string]$Arguments) {
    $command = Start-Process -FilePath $lively.Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    if (-not $command.WaitForExit(10000)) {
        throw 'Lively did not finish accepting a command within 10 seconds. Check its window and logs before rerunning setup; its processes were left running.'
    }
    if ($command.ExitCode -ne 0) { throw "Lively exited with code $($command.ExitCode) while accepting a command." }
}

try {
    if ($env:OS -ne 'Windows_NT') { throw 'Desktop installation requires Windows. Open grid-wallpaper.html in a browser to preview on other systems.' }
    if ($RemoveSettingsLink) {
        Assert-SettingsLink
        if ($Preview) { Write-Output 'Would remove only the per-user Grid Wallpaper settings link and warm-start entry.' }
        else {
            $registeredCommand = if (Test-Path -LiteralPath (Join-Path $settingsKey 'shell\open\command')) { (Get-Item -LiteralPath (Join-Path $settingsKey 'shell\open\command')).GetValue('') } else { '' }
            if ($registeredCommand -match '^"([^"]+\\grid-settings\.exe)"(?: --uri "%1")?$') { Close-SettingsHost (Split-Path $matches[1] -Parent) }
            Remove-SettingsLink
            Write-Output 'Removed the settings link and warm-start entry. Wallpapers and Lively were left in place.'
        }
        return
    }
    Assert-SettingsLink
    foreach ($file in $runtimeFiles) {
        $null = Get-RuntimeSource $file
    }
    $metadata = Get-Content -LiteralPath (Get-RuntimeSource 'LivelyInfo.json') -Raw | ConvertFrom-Json
    $null = Get-Content -LiteralPath (Get-RuntimeSource 'LivelyProperties.json') -Raw | ConvertFrom-Json
    $lively = Find-Lively
    $state = Get-LivelyState $lively -AllowInitializing
    if ($Preview) {
        Write-Output 'Preview only: no files, applications, wallpaper, or settings were changed.'
        Write-Output 'Would register the per-user Grid settings link and a warm-start entry for responsive controls.'
        if ($lively) { Write-Output ('Lively: ' + $lively.Executable) }
        else { Write-Output ('Would install with WinGet: ' + $packageId + ' (official stable package).') }
        if ($state.SettingsReady) {
            Assert-Destination $state.Destination $metadata
            Assert-HostConfig $state.Destination
            Write-Output ('Would copy ' + $runtimeFiles.Count + ' runtime files to: ' + $state.Destination)
            if (-not $SkipLaunch) { Write-Output ('Would open Lively and submit: setwp --file "' + $state.CommandDirectory + '"') }
        } else {
            Write-Output 'Lively has not supplied a valid library location yet. Setup will wait for its settings before copying files.'
        }
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
        $state = Get-LivelyState $lively -AllowInitializing
    }
    if ($SkipLaunch) {
        if (-not $state.SettingsReady) {
            Write-Warning 'Lively has no readable library location yet. No wallpaper files were copied. Open Lively once, then rerun setup.'
            exit 2
        }
        Assert-Destination $state.Destination $metadata
        Assert-HostConfig $state.Destination
        Close-SettingsHost $state.Destination
        Copy-Runtime $state.Destination
        Write-HostConfig $state.Destination $lively
        Register-SettingsLink $state.Destination
        Write-Output ('Grid Wallpaper files installed and verified: ' + $state.Destination)
        Write-Output 'Launch skipped. Rerun without -SkipLaunch to open the wallpaper. Lively owns customization and removal through its library.'
        return
    }
    if (-not (Test-LivelyRunning $lively.Executable) -or -not $state.SettingsReady) {
        if ($state.FirstRun) { Write-Output 'Opening Lively. Startup and battery preferences are available in its settings.' }
        $null = Start-Process -FilePath $lively.Executable -ArgumentList 'app --showApp false' -WindowStyle Hidden -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
        do {
            Start-Sleep -Milliseconds 500
            $state = Get-LivelyState $lively -AllowInitializing
            $ready = (Test-LivelyRunning $lively.Executable) -and $state.SettingsReady
        } while (-not $ready -and [DateTime]::UtcNow -lt $deadline)
        if (-not $ready) {
            Write-Warning 'Lively did not supply readable settings in time. No wallpaper files were copied. Complete or open Lively, then rerun setup.'
            exit 2
        }
    }
    Assert-Destination $state.Destination $metadata
    Assert-HostConfig $state.Destination
    $refreshLibrary = $false
    foreach ($file in @('LivelyInfo.json', $metadata.Thumbnail, $metadata.Preview)) {
        if (-not $file) { continue }
        $installed = Join-Path $state.Destination $file
        if (-not (Test-Path -LiteralPath $installed -PathType Leaf) -or
            (Get-FileHash -LiteralPath $installed).Hash -cne (Get-FileHash -LiteralPath (Get-RuntimeSource $file)).Hash) {
            $refreshLibrary = $true
        }
    }
    Close-SettingsHost $state.Destination
    Copy-Runtime $state.Destination
    Write-HostConfig $state.Destination $lively
    Register-SettingsLink $state.Destination
    Write-Output ('Grid Wallpaper files installed and verified: ' + $state.Destination)
    $arguments = 'setwp --file "' + $state.CommandDirectory + '"'
    Invoke-LivelyCommand $arguments
    Warm-SettingsHost $state.Destination
    if ($refreshLibrary) {
        Write-Output 'Refreshing the Lively library window to show the wallpaper thumbnail and description.'
        $uiPath = Get-LivelyUiPath $lively
        $oldUi = @(Get-Process -Name 'Lively.UI.WinUI' -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq $uiPath })
        Invoke-LivelyCommand 'app --showApp false'
        $deadline = [DateTime]::UtcNow.AddSeconds(8)
        do {
            $remainingUi = @($oldUi | Where-Object { -not $_.HasExited })
            if ($remainingUi.Count) { Start-Sleep -Milliseconds 250 }
        } while ($remainingUi.Count -and [DateTime]::UtcNow -lt $deadline)
        if ($remainingUi.Count) {
            Write-Warning 'Lively is still closing its library window. Reopen the library from its tray icon to see updated metadata.'
        } else {
            Invoke-LivelyCommand 'app --showApp true'
        }
    }
    Write-Output 'Submitted Grid Wallpaper to Lively. Confirm the animated grid on your desktop; this command alone cannot verify rendering.'
    Write-Output 'Open the grid settings button for your custom panel. Changes save through Lively. Startup, battery pause, displays, and removal are managed in Lively.'
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}
