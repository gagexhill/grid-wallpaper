#requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
if ($env:OS -ne 'Windows_NT') { throw 'Installer regression checks require Windows PowerShell.' }

$repositoryDirectory = Split-Path $PSScriptRoot -Parent
$installerPath = Join-Path $repositoryDirectory 'install.ps1'
$runtimeNames = Get-Content -LiteralPath (Join-Path $repositoryDirectory 'wallpaper-files.json') -Raw | ConvertFrom-Json
$metadataText = Get-Content -LiteralPath (Join-Path $repositoryDirectory 'LivelyInfo.json') -Raw
$metadata = $metadataText | ConvertFrom-Json
$fixtureParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$fixtureName = 'grid-wallpaper-install-test-' + [Guid]::NewGuid().ToString('N')
$fixtureDirectory = Join-Path $fixtureParent $fixtureName
$registryFixtureId = [Guid]::NewGuid().ToString('N')
$registryFixtureName = 'grid-wallpaper-test-' + $registryFixtureId
$registryFixtureKey = 'HKCU:\Software\Classes\' + $registryFixtureName
$registrySiblingKey = $registryFixtureKey + '-unrelated'
$registryFixturesReserved = $false
$configJunctionPath = Join-Path $fixtureDirectory 'linked-host-config\windows-host.json'
$module = $null
$assertionCount = 0

function Assert-Check([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    $script:assertionCount++
}

function Assert-Fails([scriptblock]$Action, [string]$Message, [string]$ExpectedFragment = '') {
    $failureMessage = $null
    try { & $Action | Out-Null } catch { $failureMessage = $_.Exception.Message }
    Assert-Check ($null -ne $failureMessage) $Message
    if ($ExpectedFragment) {
        Assert-Check ($failureMessage.Contains($ExpectedFragment)) ($Message + ': unexpected failure: ' + $failureMessage)
    }
}

function Write-Fixture([string]$Path, [string]$Content) {
    $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    [IO.File]::WriteAllText($Path, $Content)
}

try {
    foreach ($registryPath in @($registryFixtureKey, $registrySiblingKey)) {
        Assert-Check (-not (Test-Path -LiteralPath $registryPath)) 'Registry fixture keys must not already exist.'
        $mergedPath = 'Registry::HKEY_CLASSES_ROOT\' + (Split-Path $registryPath -Leaf)
        Assert-Check (-not (Test-Path -LiteralPath $mergedPath)) 'Registry fixture schemes must not shadow existing registrations.'
    }
    $registryFixturesReserved = $true
    $null = [IO.Directory]::CreateDirectory($fixtureDirectory)
    $packageDirectory = Join-Path $fixtureDirectory 'package'
    $hostBuildDirectory = Join-Path $packageDirectory 'dist\settings-host'
    $normalDataDirectory = Join-Path $fixtureDirectory 'normal-data'
    $storeDataDirectory = Join-Path $fixtureDirectory 'store-data'
    $null = [IO.Directory]::CreateDirectory($packageDirectory)

    $parseTokens = $null
    $parseErrors = $null
    $installerAst = [Management.Automation.Language.Parser]::ParseFile($installerPath, [ref]$parseTokens, [ref]$parseErrors)
    Assert-Check ($parseErrors.Count -eq 0) 'The installer must parse in Windows PowerShell 5.1.'
    $helperNames = @('Get-LivelyState', 'Assert-Destination', 'Get-RuntimeSource', 'Copy-Runtime',
        'Assert-SettingsLink', 'Register-SettingsLink', 'Remove-SettingsLink', 'Assert-HostConfig', 'Write-HostConfig', 'Get-LivelyUiPath')
    $helperDefinitions = foreach ($helperName in $helperNames) {
        $helperMatches = @($installerAst.FindAll({
            param($node)
            $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $helperName
        }, $false))
        Assert-Check ($helperMatches.Count -eq 1) ('Expected one installer helper: ' + $helperName)
        $helperMatches[0].Extent.Text
    }
    $normalDataLiteral = "'" + $normalDataDirectory.Replace("'", "''") + "'"
    $settingsKeyLiteral = "'" + $registryFixtureKey.Replace("'", "''") + "'"
    $settingsUriLiteral = "'" + $registryFixtureName + ":'"
    $runtimeLiterals = @($runtimeNames | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', '
    $moduleText = '$ErrorActionPreference = ''Stop''' + "`n" +
        'Set-StrictMode -Version 2.0' + "`n" +
        '$normalDataDirectory = ' + $normalDataLiteral + "`n" +
        '$runtimeFiles = @(' + $runtimeLiterals + ')' + "`n" +
        '$settingsKey = ' + $settingsKeyLiteral + "`n" +
        '$integration = [pscustomobject]@{ settingsUri = ' + $settingsUriLiteral + ' }' + "`n" +
        ($helperDefinitions -join "`n`n")
    $modulePath = Join-Path $packageDirectory 'installer-fixture.psm1'
    Write-Fixture $modulePath $moduleText
    foreach ($runtimeName in $runtimeNames) {
        $sourceDirectory = if ($runtimeName -match '\.(exe|dll)$') { $hostBuildDirectory } else { $packageDirectory }
        Write-Fixture (Join-Path $sourceDirectory $runtimeName) ('fixture: ' + $runtimeName)
    }
    Write-Fixture (Join-Path $packageDirectory 'LivelyInfo.json') $metadataText
    Write-Fixture (Join-Path $packageDirectory 'unlisted-note.txt') 'This must never be copied.'
    Write-Fixture (Join-Path $packageDirectory 'windows-host.json') '{"localOnly":"must not be copied"}'
    $module = Import-Module -Name $modulePath -PassThru -Force -DisableNameChecking
    $lively = [pscustomobject]@{ Executable = (Join-Path $fixtureDirectory 'Lively.exe'); DataDirectory = $normalDataDirectory; Store = $false }
    $settingsPath = Join-Path $normalDataDirectory 'Settings.json'

    Assert-Check ((Get-LivelyUiPath $lively) -ceq (Join-Path $fixtureDirectory 'Plugins\UI\Lively.UI.WinUI.exe')) 'Standalone library refresh must identify the UI under Plugins/UI.'
    $storeInstallation = [pscustomobject]@{ Executable = (Join-Path $fixtureDirectory 'store package\Lively\Lively.exe'); Store = $true }
    Assert-Check ((Get-LivelyUiPath $storeInstallation) -ceq (Join-Path $fixtureDirectory 'store package\Lively.UI.WinUI.exe')) 'Store library refresh must identify the UI beside its core directory.'
    Assert-Check ($runtimeNames -contains 'grid-settings.exe') 'The runtime manifest must include the native settings host.'
    Assert-Check (@($runtimeNames | Where-Object { $_ -match '\.dll$' }).Count -gt 0) 'The runtime manifest must include native host dependencies.'
    Assert-Check ((Get-RuntimeSource 'grid-settings.exe') -ceq (Join-Path $hostBuildDirectory 'grid-settings.exe')) 'Source checkouts must resolve built native files under dist/settings-host.'
    $rootHostSource = Join-Path $packageDirectory 'grid-settings.exe'
    Write-Fixture $rootHostSource 'package-root host fixture'
    Assert-Check ((Get-RuntimeSource 'grid-settings.exe') -ceq $rootHostSource) 'Extracted package files must take precedence over development build output.'
    Assert-Fails { Get-RuntimeSource 'missing-fixture.dll' } 'Missing runtime dependencies must fail clearly.' 'package is incomplete'
    Assert-Check ($runtimeNames -notcontains 'windows-host.json') 'Machine-specific host configuration must never enter the runtime allowlist.'
    $packageAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repositoryDirectory 'scripts\package.ps1'), [ref]$parseTokens, [ref]$parseErrors)
    Assert-Check ($parseErrors.Count -eq 0) 'The package script must parse in Windows PowerShell 5.1.'
    $packageFileAssignments = @($packageAst.FindAll({
        param($node)
        $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$files'
    }, $true))
    Assert-Check ($packageFileAssignments.Count -gt 0) 'The package script must declare its file allowlist.'
    $packageLiteralFiles = @($packageFileAssignments | ForEach-Object {
        $_.Right.FindAll({ param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] }, $true) |
            ForEach-Object { $_.Value }
    })
    Assert-Check ($packageLiteralFiles -notcontains 'windows-host.json') 'Machine-specific host configuration must never enter package file additions.'
    Write-Output 'PASS native runtime source resolution and local configuration exclusion'

    $state = Get-LivelyState $lively
    Assert-Check (-not $state.SettingsReady) 'Missing settings must not report a configured library.'
    Assert-Check (-not (Test-Path -LiteralPath $state.Destination)) 'Reading missing settings must not create a guessed library.'
    foreach ($settingsText in @('', '{"WallpaperDir":', '{}')) {
        Write-Fixture $settingsPath $settingsText
        $state = Get-LivelyState $lively -AllowInitializing
        Assert-Check (-not $state.SettingsReady) 'Empty, partial, or incomplete settings must stay unready while initializing.'
        Assert-Check (-not (Test-Path -LiteralPath $state.Destination)) 'Tolerating initializing settings must not create a library.'
        Assert-Fails { Get-LivelyState $lively } 'Strict settings reads must reject empty, partial, or incomplete settings.'
    }
    Write-Output 'PASS missing, empty, partial, and incomplete native settings'

    $customLibrary = Join-Path $fixtureDirectory 'custom library'
    Write-Fixture $settingsPath (@{ WallpaperDir = $customLibrary; IsFirstRun = $true } | ConvertTo-Json)
    $state = Get-LivelyState $lively
    $expectedCustomDestination = Join-Path $customLibrary 'wallpapers\grid-wallpaper'
    Assert-Check $state.SettingsReady 'A complete library setting is ready even when Lively retains IsFirstRun.'
    Assert-Check ($state.Destination -ceq $expectedCustomDestination) 'The configured custom library must own installation.'
    Assert-Check ($state.CommandDirectory -ceq $expectedCustomDestination) 'Native setwp must use the configured project directory.'
    Assert-Check (-not (Test-Path -LiteralPath $expectedCustomDestination)) 'Reading a custom location must not create files.'
    Write-Output 'PASS custom library and native readiness'

    $store = [pscustomobject]@{ DataDirectory = $storeDataDirectory; Store = $true }
    $storeSettingsPath = Join-Path $storeDataDirectory 'Settings.json'
    $logicalLibrary = Join-Path $normalDataDirectory 'Library'
    Write-Fixture $storeSettingsPath (@{ WallpaperDir = $logicalLibrary; IsFirstRun = $false } | ConvertTo-Json)
    $state = Get-LivelyState $store
    Assert-Check ($state.CommandDirectory -ceq (Join-Path $logicalLibrary 'wallpapers\grid-wallpaper')) 'Store commands must retain the host logical path.'
    Assert-Check ($state.Destination -ceq (Join-Path $storeDataDirectory 'Library\wallpapers\grid-wallpaper')) 'Store copies must use the physical package data path.'
    Write-Fixture $storeSettingsPath (@{ WallpaperDir = $customLibrary; IsFirstRun = $false } | ConvertTo-Json)
    $state = Get-LivelyState $store
    Assert-Check ($state.Destination -ceq $expectedCustomDestination) 'Store custom libraries outside redirected data must remain unchanged.'
    Write-Output 'PASS Microsoft Store path translation'

    Assert-Destination $expectedCustomDestination $metadata
    Assert-Check (-not (Test-Path -LiteralPath $expectedCustomDestination)) 'Collision checks must not create the target.'
    Copy-Runtime $expectedCustomDestination
    Assert-Destination $expectedCustomDestination $metadata
    $copiedNames = @(Get-ChildItem -LiteralPath $expectedCustomDestination -File | Select-Object -ExpandProperty Name)
    Assert-Check ($copiedNames.Count -eq $runtimeNames.Count) 'Only runtime manifest files may be installed.'
    Assert-Check (-not (Test-Path -LiteralPath (Join-Path $expectedCustomDestination 'unlisted-note.txt'))) 'Unlisted source files must be excluded.'
    Assert-Check (-not (Test-Path -LiteralPath (Join-Path $expectedCustomDestination 'installer-fixture.psm1'))) 'Test helpers must never be copied.'
    Assert-Check (-not (Test-Path -LiteralPath (Join-Path $expectedCustomDestination 'windows-host.json'))) 'A source-machine host configuration must never be copied.'
    foreach ($runtimeName in $runtimeNames) {
        Assert-Check ((Get-FileHash -LiteralPath (Join-Path $expectedCustomDestination $runtimeName)).Hash -ceq
            (Get-FileHash -LiteralPath (Get-RuntimeSource $runtimeName)).Hash) ('Installed runtime bytes differ: ' + $runtimeName)
    }
    Write-Output 'PASS allowlisted and verified runtime installation'

    $savedSettingsPath = Join-Path $customLibrary 'SaveData\wpdata\grid-wallpaper\settings.json'
    Write-Fixture $savedSettingsPath '{"preserved":true}'
    $existingExtraPath = Join-Path $expectedCustomDestination 'existing-note.txt'
    Write-Fixture $existingExtraPath 'preserve existing unrelated data'
    Write-Fixture (Join-Path $packageDirectory $runtimeNames[0]) 'updated runtime fixture'
    Copy-Runtime $expectedCustomDestination
    Assert-Destination $expectedCustomDestination $metadata
    Assert-Check ((Get-Content -LiteralPath (Join-Path $expectedCustomDestination $runtimeNames[0]) -Raw) -ceq 'updated runtime fixture') 'Repeat installation must update runtime content.'
    Assert-Check ((Get-Content -LiteralPath $savedSettingsPath -Raw) -ceq '{"preserved":true}') 'Repeat installation must preserve native saved customization.'
    Assert-Check ((Get-Content -LiteralPath $existingExtraPath -Raw) -ceq 'preserve existing unrelated data') 'Repeat installation must preserve unrelated existing files.'
    Write-Output 'PASS repeat installation preserves native settings'

    $unknownDestination = Join-Path $fixtureDirectory 'unknown-wallpaper'
    $unknownContentPath = Join-Path $unknownDestination 'existing.txt'
    Write-Fixture $unknownContentPath 'existing wallpaper'
    Assert-Fails { Assert-Destination $unknownDestination $metadata } 'Unknown populated targets must be rejected.' 'without Grid Wallpaper metadata'
    Assert-Check ((Get-Content -LiteralPath $unknownContentPath -Raw) -ceq 'existing wallpaper') 'Collision checks must preserve existing content.'
    Write-Fixture (Join-Path $unknownDestination 'LivelyInfo.json') '{"Title":"Other Wallpaper","Author":"Other","FileName":"other.html"}'
    Assert-Fails { Assert-Destination $unknownDestination $metadata } 'Another wallpaper metadata identity must be rejected.' 'different wallpaper'
    $fileDestination = Join-Path $fixtureDirectory 'file-target'
    Write-Fixture $fileDestination 'existing file'
    Assert-Fails { Assert-Destination $fileDestination $metadata } 'A file may not be used as an installation directory.' 'regular directory'
    $blockedDestination = Join-Path $fixtureDirectory 'blocked-runtime'
    $null = [IO.Directory]::CreateDirectory((Join-Path $blockedDestination $runtimeNames[-1]))
    Assert-Fails { Copy-Runtime $blockedDestination } 'All runtime target types must be checked before copying.' 'not a regular file'
    Assert-Check (-not (Test-Path -LiteralPath (Join-Path $blockedDestination $runtimeNames[0]))) 'A target collision must fail before any runtime file is copied.'
    Write-Output 'PASS collisions fail before overwriting files'

    $hostConfigPath = Join-Path $expectedCustomDestination 'windows-host.json'
    Assert-HostConfig $expectedCustomDestination
    Assert-Check (-not (Test-Path -LiteralPath $hostConfigPath)) 'Host configuration preflight must not create machine-specific files.'
    Write-HostConfig $expectedCustomDestination $lively
    $hostConfig = Get-Content -LiteralPath $hostConfigPath -Raw | ConvertFrom-Json
    Assert-Check (@($hostConfig.PSObject.Properties).Count -eq 3) 'Host configuration must contain only the three required local paths.'
    Assert-Check ($hostConfig.LivelyExecutable -ceq $lively.Executable) 'Host configuration must use the detected Lively executable.'
    Assert-Check ($hostConfig.LivelyDataDirectory -ceq $lively.DataDirectory) 'Host configuration must use the detected native data directory.'
    Assert-Check ($hostConfig.WallpaperDirectory -ceq $expectedCustomDestination) 'Host configuration must use the exact installed wallpaper directory.'
    $relocatedLively = [pscustomobject]@{ Executable = (Join-Path $fixtureDirectory 'relocated\Lively.exe'); DataDirectory = $storeDataDirectory }
    Write-HostConfig $expectedCustomDestination $relocatedLively
    $hostConfig = Get-Content -LiteralPath $hostConfigPath -Raw | ConvertFrom-Json
    Assert-Check ($hostConfig.LivelyExecutable -ceq $relocatedLively.Executable -and $hostConfig.LivelyDataDirectory -ceq $storeDataDirectory) 'Repeated setup must refresh machine-specific paths from current detection.'
    $blockedHostDirectory = Join-Path $fixtureDirectory 'blocked-host-config'
    $blockedHostConfigPath = Join-Path $blockedHostDirectory 'windows-host.json'
    $null = [IO.Directory]::CreateDirectory($blockedHostConfigPath)
    Assert-Fails { Assert-HostConfig $blockedHostDirectory } 'Host configuration preflight must reject a directory.' 'regular file'
    Assert-Fails { Write-HostConfig $blockedHostDirectory $lively } 'A directory may not be overwritten as host configuration.' 'regular file'
    Assert-Check (Test-Path -LiteralPath $blockedHostConfigPath -PathType Container) 'Host configuration collision handling must preserve directories.'
    $junctionTarget = Join-Path $fixtureDirectory 'host-config-target'
    $junctionSentinel = Join-Path $junctionTarget 'preserved.txt'
    Write-Fixture $junctionSentinel 'preserve linked target'
    $null = [IO.Directory]::CreateDirectory((Split-Path $configJunctionPath -Parent))
    $null = New-Item -ItemType Junction -Path $configJunctionPath -Target $junctionTarget
    Assert-Check ([bool]((Get-Item -LiteralPath $configJunctionPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'The reparse fixture must be an actual directory junction.'
    Assert-Fails { Assert-HostConfig (Split-Path $configJunctionPath -Parent) } 'Host configuration preflight must reject a reparse point.' 'regular file'
    Assert-Fails { Write-HostConfig (Split-Path $configJunctionPath -Parent) $lively } 'Host configuration must reject a reparse point.' 'regular file'
    Assert-Check ((Get-Content -LiteralPath $junctionSentinel -Raw) -ceq 'preserve linked target') 'Rejected reparse points must preserve their targets.'
    Write-Output 'PASS local host configuration and unsafe target rejection'

    Assert-SettingsLink
    Assert-Check (-not (Test-Path -LiteralPath $registryFixtureKey)) 'Checking an available settings scheme must not register it.'
    Assert-Fails { Register-SettingsLink $blockedHostDirectory } 'A missing host must fail before registration.' 'settings host is missing'
    Assert-Check (-not (Test-Path -LiteralPath $registryFixtureKey)) 'A missing host must leave the registry unchanged.'
    Register-SettingsLink $expectedCustomDestination
    $commandKey = Join-Path $registryFixtureKey 'shell\open\command'
    $expectedCommand = '"' + (Join-Path $expectedCustomDestination 'grid-settings.exe') + '"'
    $registeredCommand = (Get-Item -LiteralPath $commandKey).GetValue('')
    Assert-Check ($registeredCommand -ceq $expectedCommand) 'The settings command must be the exact quoted host path with no arguments.'
    Assert-Check ($registeredCommand -notmatch '%(?:1|[Ll]|\*)') 'Settings links must never forward URI payloads.'
    $registeredKey = Get-Item -LiteralPath $registryFixtureKey
    Assert-Check ($registeredKey.GetValue('GridWallpaperManaged', 0) -eq 1) 'Registration must mark the exact scheme as managed.'
    Assert-Check ($registeredKey.GetValueNames() -contains 'URL Protocol') 'Registration must identify the scheme as a URL protocol.'
    Assert-Check ($registeredKey.GetValue('URL Protocol') -ceq '') 'The URL protocol marker must be an empty string.'
    $registeredKey.Dispose()
    Register-SettingsLink $expectedCustomDestination
    Assert-Check ((Get-Item -LiteralPath $commandKey).GetValue('') -ceq $expectedCommand) 'Repeated settings registration must retain the fixed command.'
    $relocatedHostDirectory = Join-Path $fixtureDirectory 'relocated host'
    Write-Fixture (Join-Path $relocatedHostDirectory 'grid-settings.exe') 'This is a path fixture, not an executable.'
    Register-SettingsLink $relocatedHostDirectory
    Assert-Check ((Get-Item -LiteralPath $commandKey).GetValue('') -ceq ('"' + (Join-Path $relocatedHostDirectory 'grid-settings.exe') + '"')) 'Registration must update an owned link when the installation directory changes.'
    Write-Output 'PASS fixed settings host command and repeat registration'

    $null = New-Item -Path $registrySiblingKey
    $null = New-ItemProperty -LiteralPath $registrySiblingKey -Name 'UnrelatedSentinel' -Value 'preserve sibling' -PropertyType String
    Remove-SettingsLink
    Assert-Check (-not (Test-Path -LiteralPath $registryFixtureKey)) 'Removal must delete the exact owned registration.'
    Assert-Check ((Get-Item -LiteralPath $registrySiblingKey).GetValue('UnrelatedSentinel') -ceq 'preserve sibling') 'Removal must preserve unrelated sibling registrations.'
    Remove-SettingsLink
    Assert-Check ((Get-Item -LiteralPath $registrySiblingKey).GetValue('UnrelatedSentinel') -ceq 'preserve sibling') 'Repeated removal must leave unrelated registrations unchanged.'
    $null = New-Item -Path $registryFixtureKey
    $null = New-ItemProperty -LiteralPath $registryFixtureKey -Name 'CollisionSentinel' -Value 'preserve existing registration' -PropertyType String
    Assert-Fails { Assert-SettingsLink } 'An unmarked settings scheme must be rejected.' 'owned by another application'
    Assert-Fails { Register-SettingsLink $expectedCustomDestination } 'Registration must reject an unmarked existing scheme.' 'owned by another application'
    Assert-Fails { Remove-SettingsLink } 'Removal must reject an unmarked existing scheme.' 'owned by another application'
    $null = New-ItemProperty -LiteralPath $registryFixtureKey -Name 'GridWallpaperManaged' -Value 0 -PropertyType DWord
    Assert-Fails { Register-SettingsLink $expectedCustomDestination } 'A non-owned marker value must also reject registration.' 'owned by another application'
    Assert-Check ((Get-Item -LiteralPath $registryFixtureKey).GetValue('CollisionSentinel') -ceq 'preserve existing registration') 'Collision handling must preserve existing registration data.'
    Assert-Check (-not (Test-Path -LiteralPath $commandKey)) 'Collision handling must not create a command.'
    Assert-Check ((Get-Item -LiteralPath $registrySiblingKey).GetValue('UnrelatedSentinel') -ceq 'preserve sibling') 'Collision handling must preserve unrelated registrations.'
    Write-Output 'PASS settings link ownership collisions and exact removal'

    Write-Output ('Installer regression checks passed: ' + $assertionCount + ' assertions. Only isolated temporary files and GUID-owned test registrations were used.')
} finally {
    if ($module) { Remove-Module -ModuleInfo $module -Force }
    if ($registryFixturesReserved) {
        foreach ($registryPath in @($registryFixtureKey, $registrySiblingKey)) {
            if (-not (Test-Path -LiteralPath $registryPath)) { continue }
            $registryItem = Get-Item -LiteralPath $registryPath
            $expectedRegistryName = $registryPath.Replace('HKCU:', 'HKEY_CURRENT_USER')
            $expectedRegistryRoot = 'HKEY_CURRENT_USER\Software\Classes\grid-wallpaper-test-' + $registryFixtureId
            if ($registryFixtureId -cnotmatch '^[a-f0-9]{32}$' -or
                $registryItem.Name -cne $expectedRegistryName -or
                ($registryItem.Name -cne $expectedRegistryRoot -and $registryItem.Name -cne ($expectedRegistryRoot + '-unrelated'))) {
                throw 'Refusing to clean a registry key outside the exact GUID-owned test registrations.'
            }
            $registryItem.Dispose()
            Remove-Item -LiteralPath $registryPath -Recurse -Force
        }
    }
    if (Test-Path -LiteralPath $configJunctionPath) {
        $junctionItem = Get-Item -LiteralPath $configJunctionPath -Force
        $expectedJunctionPath = Join-Path (Join-Path $fixtureParent $fixtureName) 'linked-host-config\windows-host.json'
        if ([IO.Path]::GetFullPath($junctionItem.FullName) -cne [IO.Path]::GetFullPath($expectedJunctionPath) -or
            -not $junctionItem.FullName.StartsWith($fixtureDirectory + '\', [StringComparison]::OrdinalIgnoreCase) -or
            -not ($junctionItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Refusing to clean a junction outside the exact test fixture path.'
        }
        [IO.Directory]::Delete($configJunctionPath)
    }
    if (Test-Path -LiteralPath $fixtureDirectory) {
        $resolvedFixture = Get-Item -LiteralPath $fixtureDirectory -Force
        $resolvedFullPath = [IO.Path]::GetFullPath($resolvedFixture.FullName).TrimEnd('\')
        $expectedFullPath = [IO.Path]::GetFullPath((Join-Path $fixtureParent $fixtureName)).TrimEnd('\')
        if ($resolvedFullPath -cne $expectedFullPath -or
            -not $resolvedFullPath.StartsWith($fixtureParent + '\', [StringComparison]::OrdinalIgnoreCase) -or
            ($resolvedFixture.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Refusing to clean a fixture path outside the exact test directory.'
        }
        Remove-Item -LiteralPath $resolvedFullPath -Recurse -Force
    }
}
