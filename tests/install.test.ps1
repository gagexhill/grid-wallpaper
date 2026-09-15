#requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
if ($env:OS -ne 'Windows_NT') { throw 'Installer regression checks require Windows PowerShell.' }

$repositoryDirectory = Split-Path $PSScriptRoot -Parent
$installerPath = Join-Path $repositoryDirectory 'install.ps1'
$runtimeNames = Get-Content -LiteralPath (Join-Path $repositoryDirectory 'wallpaper-files.json') -Raw | ConvertFrom-Json
$metadataText = Get-Content -LiteralPath (Join-Path $repositoryDirectory 'wallpaper\LivelyInfo.json') -Raw
$metadata = $metadataText | ConvertFrom-Json
$fixtureParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$fixtureName = 'grid-wallpaper-install-test-' + [Guid]::NewGuid().ToString('N')
$fixtureDirectory = Join-Path $fixtureParent $fixtureName
$registryFixtureId = [Guid]::NewGuid().ToString('N')
$registryFixtureName = 'grid-wallpaper-test-' + $registryFixtureId
$registryFixtureKey = 'HKCU:\Software\Classes\' + $registryFixtureName
$registrySiblingKey = $registryFixtureKey + '-unrelated'
$registryStartupKey = $registryFixtureKey + '-startup'
$registryStartupName = 'WarmStart-' + $registryFixtureId
$registryStartupSiblingName = 'UnrelatedFixtureStartup'
$registryFixturesReserved = $false
$configJunctionPath = Join-Path $fixtureDirectory 'linked-host-config\windows-host.json'
$sourceJunctionPath = Join-Path $fixtureDirectory 'flat-release\wallpaper'
$retiredJunctionPath = Join-Path $fixtureDirectory 'linked-retired-runtime\grid-native-settings.js'
$module = $null
$flatModule = $null
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
    foreach ($registryPath in @($registryFixtureKey, $registrySiblingKey, $registryStartupKey)) {
        Assert-Check (-not (Test-Path -LiteralPath $registryPath)) 'Registry fixture keys must not already exist.'
        $mergedPath = 'Registry::HKEY_CLASSES_ROOT\' + (Split-Path $registryPath -Leaf)
        Assert-Check (-not (Test-Path -LiteralPath $mergedPath)) 'Registry fixture schemes must not shadow existing registrations.'
    }
    $registryFixturesReserved = $true
    $null = [IO.Directory]::CreateDirectory($fixtureDirectory)
    $packageDirectory = Join-Path $fixtureDirectory 'package'
    $wallpaperSourceDirectory = Join-Path $packageDirectory 'wallpaper'
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
    $startupKeyLiteral = "'" + $registryStartupKey.Replace("'", "''") + "'"
    $startupNameLiteral = "'" + $registryStartupName + "'"
    $runtimeLiterals = @($runtimeNames | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', '
    $moduleText = '$ErrorActionPreference = ''Stop''' + "`n" +
        'Set-StrictMode -Version 2.0' + "`n" +
        '$normalDataDirectory = ' + $normalDataLiteral + "`n" +
        '$runtimeFiles = @(' + $runtimeLiterals + ')' + "`n" +
        '$settingsKey = ' + $settingsKeyLiteral + "`n" +
        '$startupKey = ' + $startupKeyLiteral + "`n" +
        '$startupName = ' + $startupNameLiteral + "`n" +
        '$integration = [pscustomobject]@{ settingsUri = ' + $settingsUriLiteral + ' }' + "`n" +
        ($helperDefinitions -join "`n`n")
    $modulePath = Join-Path $packageDirectory 'installer-fixture.psm1'
    Write-Fixture $modulePath $moduleText
    foreach ($runtimeName in $runtimeNames) {
        $sourceDirectory = if ($runtimeName -ceq 'LICENSE.txt') { $packageDirectory }
            elseif ($runtimeName -match '\.(exe|dll|txt)$') { $hostBuildDirectory } else { $wallpaperSourceDirectory }
        Write-Fixture (Join-Path $sourceDirectory $runtimeName) ('fixture: ' + $runtimeName)
    }
    Write-Fixture (Join-Path $wallpaperSourceDirectory 'LivelyInfo.json') $metadataText
    Write-Fixture (Join-Path $packageDirectory 'unlisted-note.txt') 'This must never be copied.'
    Write-Fixture (Join-Path $packageDirectory 'windows-host.json') '{"localOnly":"must not be copied"}'
    Write-Fixture (Join-Path $packageDirectory 'windows-telemetry.js') 'installed-session fixture: must not be copied'
    $module = Import-Module -Name $modulePath -PassThru -Force -DisableNameChecking
    $lively = [pscustomobject]@{ Executable = (Join-Path $fixtureDirectory 'Lively.exe'); DataDirectory = $normalDataDirectory; Store = $false }
    $settingsPath = Join-Path $normalDataDirectory 'Settings.json'

    Assert-Check ((Get-LivelyUiPath $lively) -ceq (Join-Path $fixtureDirectory 'Plugins\UI\Lively.UI.WinUI.exe')) 'Standalone library refresh must identify the UI under Plugins/UI.'
    $storeInstallation = [pscustomobject]@{ Executable = (Join-Path $fixtureDirectory 'store package\Lively\Lively.exe'); Store = $true }
    Assert-Check ((Get-LivelyUiPath $storeInstallation) -ceq (Join-Path $fixtureDirectory 'store package\Lively.UI.WinUI.exe')) 'Store library refresh must identify the UI beside its core directory.'
    Assert-Check ($runtimeNames -contains 'grid-settings.exe') 'The runtime manifest must include the native settings host.'
    Assert-Check ($runtimeNames -ccontains 'LICENSE.txt') 'The project license must accompany installed runtime copies.'
    Assert-Check ($runtimeNames -ccontains 'webview2-license.txt') 'The separate WebView2 redistribution notice must accompany installed libraries.'
    Assert-Check (@($runtimeNames | Where-Object { $_ -match '\.dll$' }).Count -gt 0) 'The runtime manifest must include native host dependencies.'
    foreach ($runtimeName in $runtimeNames) {
        $expectedSourceDirectory = if ($runtimeName -ceq 'LICENSE.txt') { $packageDirectory }
            elseif ($runtimeName -match '\.(exe|dll|txt)$') { $hostBuildDirectory } else { $wallpaperSourceDirectory }
        Assert-Check ((Get-RuntimeSource $runtimeName) -ceq (Join-Path $expectedSourceDirectory $runtimeName)) ('Organized checkout runtime source differs: ' + $runtimeName)
    }
    Assert-Check ((Get-RuntimeSource 'grid-settings.exe') -ceq (Join-Path $hostBuildDirectory 'grid-settings.exe')) 'Source checkouts must resolve built native files under dist/settings-host.'
    $rootHostSource = Join-Path $packageDirectory 'grid-settings.exe'
    Write-Fixture $rootHostSource 'package-root host fixture'
    Assert-Check ((Get-RuntimeSource 'grid-settings.exe') -ceq $rootHostSource) 'Extracted package files must take precedence over development build output.'
    Remove-Item -LiteralPath $rootHostSource
    $rootWebSource = Join-Path $packageDirectory 'grid-wallpaper.html'
    Write-Fixture $rootWebSource 'package-root web fixture'
    Assert-Check ((Get-RuntimeSource 'grid-wallpaper.html') -ceq $rootWebSource) 'Flat runtime files must take precedence over organized wallpaper sources.'
    Remove-Item -LiteralPath $rootWebSource
    Assert-Fails { Get-RuntimeSource 'missing-fixture.dll' } 'Missing runtime dependencies must fail clearly.' 'package is incomplete'
    Assert-Fails { Get-RuntimeSource 'missing-fixture.html' } 'Missing organized wallpaper files must fail clearly.' 'package is incomplete'
    Assert-Check ($runtimeNames -notcontains 'windows-host.json') 'Machine-specific host configuration must never enter the runtime allowlist.'
    Assert-Check ($runtimeNames -notcontains 'windows-telemetry.js') 'Session telemetry configuration must never enter the runtime allowlist.'
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
    Assert-Check ($packageLiteralFiles -notcontains 'windows-telemetry.js') 'Session telemetry configuration must never enter package file additions.'
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
    Assert-Check (-not (Test-Path -LiteralPath (Join-Path $expectedCustomDestination 'windows-telemetry.js'))) 'A source-session telemetry bootstrap must never be copied.'
    foreach ($runtimeName in $runtimeNames) {
        Assert-Check ((Get-FileHash -LiteralPath (Join-Path $expectedCustomDestination $runtimeName)).Hash -ceq
            (Get-FileHash -LiteralPath (Get-RuntimeSource $runtimeName)).Hash) ('Installed runtime bytes differ: ' + $runtimeName)
    }
    Write-Output 'PASS allowlisted and verified runtime installation'

    $flatReleaseDirectory = Join-Path $fixtureDirectory 'flat-release'
    $flatModulePath = Join-Path $flatReleaseDirectory 'flat-installer-fixture.psm1'
    Write-Fixture $flatModulePath $moduleText
    foreach ($runtimeName in $runtimeNames) {
        Write-Fixture (Join-Path $flatReleaseDirectory $runtimeName) ('flat release fixture: ' + $runtimeName)
    }
    $flatPackageOnlyNames = @('wallpaper-files.json', 'install.ps1', 'README.md', 'OPERATIONS.md')
    foreach ($packageOnlyName in $flatPackageOnlyNames) {
        Write-Fixture (Join-Path $flatReleaseDirectory $packageOnlyName) ('package-only fixture: ' + $packageOnlyName)
    }
    Write-Fixture (Join-Path $flatReleaseDirectory 'LivelyInfo.json') $metadataText
    Write-Fixture (Join-Path $flatReleaseDirectory 'unlisted-note.txt') 'This flat-release note must never be installed.'
    Write-Fixture (Join-Path $flatReleaseDirectory 'windows-host.json') '{"localOnly":"must not be copied"}'
    Write-Fixture (Join-Path $flatReleaseDirectory 'windows-telemetry.js') 'installed-session fixture: must not be copied'
    $flatModule = Import-Module -Name $flatModulePath -PassThru -Force -DisableNameChecking -Prefix FlatFixture
    $flatDestination = Join-Path $fixtureDirectory 'flat-installation'
    Copy-FlatFixtureRuntime $flatDestination
    Assert-FlatFixtureDestination $flatDestination $metadata
    $flatInstalledNames = @(Get-ChildItem -LiteralPath $flatDestination -File | Select-Object -ExpandProperty Name)
    Assert-Check ($flatInstalledNames.Count -eq $runtimeNames.Count) 'Flat releases must install only the runtime manifest.'
    Assert-Check (@(Get-ChildItem -LiteralPath $flatDestination -Directory).Count -eq 0) 'Installed runtime assets must remain flat.'
    Assert-Check (-not (Test-Path -LiteralPath (Join-Path $flatReleaseDirectory 'wallpaper'))) 'The flat release fixture must not depend on the source wallpaper directory.'
    Assert-Check (-not (Test-Path -LiteralPath (Join-Path $flatReleaseDirectory 'dist'))) 'The flat release fixture must not depend on development build output.'
    foreach ($runtimeName in $runtimeNames) {
        $flatSource = Get-FlatFixtureRuntimeSource $runtimeName
        Assert-Check ($flatSource -ceq (Join-Path $flatReleaseDirectory $runtimeName)) ('Flat release runtime source differs: ' + $runtimeName)
        Assert-Check ((Get-FileHash -LiteralPath (Join-Path $flatDestination $runtimeName)).Hash -ceq
            (Get-FileHash -LiteralPath $flatSource).Hash) ('Installed flat release bytes differ: ' + $runtimeName)
    }
    foreach ($excludedName in ($flatPackageOnlyNames + @('unlisted-note.txt', 'flat-installer-fixture.psm1', 'windows-host.json', 'windows-telemetry.js'))) {
        Assert-Check (-not (Test-Path -LiteralPath (Join-Path $flatDestination $excludedName))) ('Flat releases must exclude local or unlisted files: ' + $excludedName)
    }
    Assert-Check ((Get-RuntimeSource 'grid-wallpaper.html') -ceq (Join-Path $wallpaperSourceDirectory 'grid-wallpaper.html')) 'Flat release fixtures must not replace the organized checkout helpers.'
    Write-Output 'PASS flat release installation without source directories or local configuration'

    $linkedRuntimePath = Join-Path $wallpaperSourceDirectory 'linked-only.html'
    Write-Fixture $linkedRuntimePath 'preserve linked runtime content'
    $null = New-Item -ItemType Junction -Path $sourceJunctionPath -Target $wallpaperSourceDirectory
    Assert-Check ([bool]((Get-Item -LiteralPath $sourceJunctionPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'The source fixture must be an actual wallpaper directory junction.'
    Assert-Fails { Get-FlatFixtureRuntimeSource 'linked-only.html' } 'Source fallback must reject wallpaper directory links.' 'source directories must not be links'
    Assert-Check ((Get-FlatFixtureRuntimeSource 'grid-wallpaper.html') -ceq (Join-Path $flatReleaseDirectory 'grid-wallpaper.html')) 'Complete flat releases must resolve their own files before consulting source directories.'
    Assert-Check ((Get-Content -LiteralPath $linkedRuntimePath -Raw) -ceq 'preserve linked runtime content') 'Rejected source links must preserve their targets.'
    Write-Output 'PASS linked source directory rejection and flat release precedence'

    $savedSettingsPath = Join-Path $customLibrary 'SaveData\wpdata\grid-wallpaper\settings.json'
    Write-Fixture $savedSettingsPath '{"preserved":true}'
    $existingExtraPath = Join-Path $expectedCustomDestination 'existing-note.txt'
    Write-Fixture $existingExtraPath 'preserve existing unrelated data'
    Write-Fixture (Get-RuntimeSource $runtimeNames[0]) 'updated runtime fixture'
    Copy-Runtime $expectedCustomDestination
    Assert-Destination $expectedCustomDestination $metadata
    Assert-Check ((Get-Content -LiteralPath (Join-Path $expectedCustomDestination $runtimeNames[0]) -Raw) -ceq 'updated runtime fixture') 'Repeat installation must update runtime content.'
    Assert-Check ((Get-Content -LiteralPath $savedSettingsPath -Raw) -ceq '{"preserved":true}') 'Repeat installation must preserve native saved customization.'
    Assert-Check ((Get-Content -LiteralPath $existingExtraPath -Raw) -ceq 'preserve existing unrelated data') 'Repeat installation must preserve unrelated existing files.'
    Write-Output 'PASS repeat installation preserves native settings'

    $retiredNames = @('grid-live-telemetry.js', 'grid-native-settings.js')
    foreach ($retiredName in $retiredNames) {
        Write-Fixture (Join-Path $expectedCustomDestination $retiredName) 'retired helper fixture'
        Write-Fixture (Join-Path $flatReleaseDirectory $retiredName) 'retired flat helper fixture'
    }
    Copy-Runtime $expectedCustomDestination
    Copy-FlatFixtureRuntime $flatReleaseDirectory
    foreach ($retiredName in $retiredNames) {
        Assert-Check (-not (Test-Path -LiteralPath (Join-Path $expectedCustomDestination $retiredName))) 'Upgrades must remove each merged helper.'
        Assert-Check (-not (Test-Path -LiteralPath (Join-Path $flatReleaseDirectory $retiredName))) 'Same-folder upgrades must remove each merged helper.'
    }
    foreach ($runtimeName in $runtimeNames) {
        Assert-Check ((Get-FileHash -LiteralPath (Join-Path $flatReleaseDirectory $runtimeName)).Hash -ceq
            (Get-FileHash -LiteralPath (Join-Path $flatDestination $runtimeName)).Hash) ('Same-folder upgrades must preserve current runtime bytes: ' + $runtimeName)
    }
    Assert-Check ((Get-Content -LiteralPath (Join-Path $flatReleaseDirectory 'windows-host.json') -Raw) -ceq '{"localOnly":"must not be copied"}') 'Retirement must preserve local host configuration.'
    Assert-Check ((Get-Content -LiteralPath (Join-Path $flatReleaseDirectory 'windows-telemetry.js') -Raw) -ceq 'installed-session fixture: must not be copied') 'Retirement must preserve the installed session bootstrap.'
    Assert-Check ((Get-Content -LiteralPath (Join-Path $flatReleaseDirectory 'README.md') -Raw) -ceq 'package-only fixture: README.md') 'Same-folder retirement must preserve package documentation.'
    Write-Fixture (Join-Path $expectedCustomDestination $retiredNames[0]) 'partial prior upgrade fixture'
    Copy-Runtime $expectedCustomDestination
    Copy-Runtime $expectedCustomDestination
    Assert-Check (-not (Test-Path -LiteralPath (Join-Path $expectedCustomDestination $retiredNames[0]))) 'Missing or partially retired helpers must allow repeat upgrades.'
    Assert-Check ((Get-Content -LiteralPath $savedSettingsPath -Raw) -ceq '{"preserved":true}') 'Retirement must preserve native saved customization.'
    Assert-Check ((Get-Content -LiteralPath $existingExtraPath -Raw) -ceq 'preserve existing unrelated data') 'Retirement must preserve unrelated existing files.'

    $failedUpgrade = Join-Path $fixtureDirectory 'failed-upgrade'
    Copy-Runtime $failedUpgrade
    foreach ($retiredName in $retiredNames) { Write-Fixture (Join-Path $failedUpgrade $retiredName) 'retain until verified' }
    Write-Fixture (Join-Path $failedUpgrade $runtimeNames[0]) 'outdated first file'
    $lockedRuntime = [IO.File]::Open((Join-Path $failedUpgrade $runtimeNames[-1]), [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        Assert-Fails { Copy-Runtime $failedUpgrade } 'A locked later runtime file must fail the upgrade.'
        Assert-Check ((Get-Content -LiteralPath (Join-Path $failedUpgrade $runtimeNames[0]) -Raw) -ceq 'updated runtime fixture') 'The copy-failure fixture must reach copying before failing.'
        foreach ($retiredName in $retiredNames) {
            Assert-Check ((Get-Content -LiteralPath (Join-Path $failedUpgrade $retiredName) -Raw) -ceq 'retain until verified') 'Failed upgrades must retain the retired helpers.'
        }
    } finally { $lockedRuntime.Dispose() }
    Copy-Runtime $failedUpgrade
    foreach ($retiredName in $retiredNames) {
        Assert-Check (-not (Test-Path -LiteralPath (Join-Path $failedUpgrade $retiredName))) 'Retry after releasing a copy failure must finish retirement.'
    }
    Write-Output 'PASS verified helper retirement, same-folder upgrades and failed-copy recovery'

    $legacyMetadata = $metadataText | ConvertFrom-Json
    $legacyMetadata.Author = 'Ventryn LLC'
    $legacyMetadata.License = $null
    $legacyMetadataPath = Join-Path $expectedCustomDestination 'LivelyInfo.json'
    Write-Fixture $legacyMetadataPath ($legacyMetadata | ConvertTo-Json)
    Assert-Destination $expectedCustomDestination $metadata
    foreach ($field in @('Title', 'FileName', 'Author', 'Contact')) {
        $collisionMetadata = $legacyMetadata | ConvertTo-Json | ConvertFrom-Json
        $collisionMetadata.$field = 'unrelated wallpaper'
        Write-Fixture $legacyMetadataPath ($collisionMetadata | ConvertTo-Json)
        Assert-Fails { Assert-Destination $expectedCustomDestination $metadata } ('Legacy credit migration must reject a different ' + $field + '.') 'different wallpaper'
    }
    $missingContactMetadata = $legacyMetadata | ConvertTo-Json | ConvertFrom-Json
    $missingContactMetadata.PSObject.Properties.Remove('Contact')
    Write-Fixture $legacyMetadataPath ($missingContactMetadata | ConvertTo-Json)
    Assert-Fails { Assert-Destination $expectedCustomDestination $metadata } 'Legacy credit migration must require the project contact.' 'different wallpaper'
    Write-Fixture $legacyMetadataPath ($legacyMetadata | ConvertTo-Json)
    Assert-Destination $expectedCustomDestination $metadata
    Copy-Runtime $expectedCustomDestination
    Assert-Destination $expectedCustomDestination $metadata
    $upgradedMetadata = Get-Content -LiteralPath $legacyMetadataPath -Raw | ConvertFrom-Json
    Assert-Check ($upgradedMetadata.Author -ceq 'gagexhill' -and $upgradedMetadata.License -ceq 'MIT') 'Legacy upgrades must install the approved current credit and license.'
    Assert-Fails { Assert-Destination $expectedCustomDestination $legacyMetadata } 'The legacy credit exception must not allow reverse migration.' 'different wallpaper'
    Assert-Check ((Get-Content -LiteralPath $savedSettingsPath -Raw) -ceq '{"preserved":true}') 'Legacy credit upgrades must preserve saved customization.'
    Assert-Check ((Get-FileHash -LiteralPath (Join-Path $expectedCustomDestination 'LICENSE.txt')).Hash -ceq (Get-FileHash -LiteralPath (Get-RuntimeSource 'LICENSE.txt')).Hash) 'Legacy upgrades must install the project license.'
    Write-Output 'PASS legacy credit upgrade preserves identity boundaries and customization'

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

    foreach ($retiredName in $retiredNames) {
        $retiredCollision = Join-Path $fixtureDirectory ('blocked-' + $retiredName)
        $null = [IO.Directory]::CreateDirectory((Join-Path $retiredCollision $retiredName))
        Assert-Fails { Copy-Runtime $retiredCollision } 'Retired helper directories must be rejected.' 'not a regular file'
        Assert-Check (-not (Test-Path -LiteralPath (Join-Path $retiredCollision $runtimeNames[0]))) 'Retired helper collisions must fail before copying.'
        Assert-Check (Test-Path -LiteralPath (Join-Path $retiredCollision $retiredName) -PathType Container) 'Retired helper directories must not be deleted.'
    }
    $linkedRetirement = Split-Path $retiredJunctionPath -Parent
    Write-Fixture (Join-Path $linkedRetirement $retiredNames[0]) 'preserve prior helper on collision'
    $retiredLinkTarget = Join-Path $fixtureDirectory 'retired-link-target'
    Write-Fixture (Join-Path $retiredLinkTarget 'sentinel.txt') 'preserve linked content'
    $null = New-Item -ItemType Junction -Path $retiredJunctionPath -Target $retiredLinkTarget
    Assert-Fails { Copy-Runtime $linkedRetirement } 'Retired helper junctions must be rejected.' 'not a regular file'
    Assert-Check (-not (Test-Path -LiteralPath (Join-Path $linkedRetirement $runtimeNames[0]))) 'Retired links must fail before copying.'
    Assert-Check ((Get-Content -LiteralPath (Join-Path $linkedRetirement $retiredNames[0]) -Raw) -ceq 'preserve prior helper on collision') 'Retired link preflight must precede any retirement.'
    Assert-Check ((Get-Content -LiteralPath (Join-Path $retiredLinkTarget 'sentinel.txt') -Raw) -ceq 'preserve linked content') 'Retirement must never follow directory links.'
    Write-Output 'PASS retired helper directory and junction rejection'

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
    Assert-Check (-not (Test-Path -LiteralPath $registryStartupKey)) 'Checking an available settings scheme must not create a startup key.'
    Assert-Fails { Register-SettingsLink $blockedHostDirectory } 'A missing host must fail before registration.' 'settings host is missing'
    Assert-Check (-not (Test-Path -LiteralPath $registryFixtureKey)) 'A missing host must leave the registry unchanged.'
    Assert-Check (-not (Test-Path -LiteralPath $registryStartupKey)) 'A missing host must not create a startup entry.'
    $null = New-Item -Path $registryStartupKey
    $null = New-ItemProperty -LiteralPath $registryStartupKey -Name $registryStartupSiblingName -Value 'preserve unrelated startup' -PropertyType String
    Register-SettingsLink $expectedCustomDestination
    $commandKey = Join-Path $registryFixtureKey 'shell\open\command'
    $expectedCommand = '"' + (Join-Path $expectedCustomDestination 'grid-settings.exe') + '" --uri "%1"'
    $expectedWarmCommand = '"' + (Join-Path $expectedCustomDestination 'grid-settings.exe') + '" --warm'
    $registeredCommand = (Get-Item -LiteralPath $commandKey).GetValue('')
    Assert-Check ($registeredCommand -ceq $expectedCommand) 'The settings command must use the exact quoted host path and one quoted --uri placeholder.'
    Assert-Check ([regex]::Matches($registeredCommand, '%1').Count -eq 1 -and $registeredCommand -notmatch '%(?:[Ll]|\*)') 'Only the single URI argument may be passed to the native validator.'
    Assert-Check ((Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupName) -ceq $expectedWarmCommand) 'Warm startup must use the exact quoted host path and fixed --warm argument.'
    Assert-Check ((Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupSiblingName) -ceq 'preserve unrelated startup') 'First registration must preserve unrelated startup entries.'
    $registeredKey = Get-Item -LiteralPath $registryFixtureKey
    Assert-Check ($registeredKey.GetValue('GridWallpaperManaged', 0) -eq 1) 'Registration must mark the exact scheme as managed.'
    Assert-Check ($registeredKey.GetValue('GridWallpaperWarmStartManaged', 0) -eq 1) 'Registration must record ownership of its warm-start entry.'
    Assert-Check ($registeredKey.GetValueNames() -contains 'URL Protocol') 'Registration must identify the scheme as a URL protocol.'
    Assert-Check ($registeredKey.GetValue('URL Protocol') -ceq '') 'The URL protocol marker must be an empty string.'
    $registeredKey.Dispose()
    Register-SettingsLink $expectedCustomDestination
    Assert-Check ((Get-Item -LiteralPath $commandKey).GetValue('') -ceq $expectedCommand) 'Repeated settings registration must retain the fixed command.'
    Assert-Check ((Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupName) -ceq $expectedWarmCommand) 'Repeated registration must retain the fixed warm-start command.'
    Assert-Check ((Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupSiblingName) -ceq 'preserve unrelated startup') 'Repeated registration must preserve unrelated startup entries.'
    $relocatedHostDirectory = Join-Path $fixtureDirectory 'relocated host'
    Write-Fixture (Join-Path $relocatedHostDirectory 'grid-settings.exe') 'This is a path fixture, not an executable.'
    Register-SettingsLink $relocatedHostDirectory
    Assert-Check ((Get-Item -LiteralPath $commandKey).GetValue('') -ceq ('"' + (Join-Path $relocatedHostDirectory 'grid-settings.exe') + '" --uri "%1"')) 'Registration must update an owned link when the installation directory changes.'
    Assert-Check ((Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupName) -ceq ('"' + (Join-Path $relocatedHostDirectory 'grid-settings.exe') + '" --warm')) 'Registration must update the owned warm-start entry when the installation directory changes.'
    Assert-Check ((Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupSiblingName) -ceq 'preserve unrelated startup') 'Relocation must preserve unrelated startup entries.'
    Write-Output 'PASS exact URI and warm-start commands with repeat registration'

    $null = New-Item -Path $registrySiblingKey
    $null = New-ItemProperty -LiteralPath $registrySiblingKey -Name 'UnrelatedSentinel' -Value 'preserve sibling' -PropertyType String
    Remove-SettingsLink
    Assert-Check (-not (Test-Path -LiteralPath $registryFixtureKey)) 'Removal must delete the exact owned registration.'
    Assert-Check (Test-Path -LiteralPath $registryStartupKey) 'Removal must preserve the startup key itself.'
    Assert-Check ($null -eq (Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupName, $null)) 'Removal must delete only the owned warm-start entry.'
    Assert-Check ((Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupSiblingName) -ceq 'preserve unrelated startup') 'Removal must preserve unrelated startup entries.'
    Assert-Check ((Get-Item -LiteralPath $registrySiblingKey).GetValue('UnrelatedSentinel') -ceq 'preserve sibling') 'Removal must preserve unrelated sibling registrations.'
    Remove-SettingsLink
    Assert-Check ((Get-Item -LiteralPath $registrySiblingKey).GetValue('UnrelatedSentinel') -ceq 'preserve sibling') 'Repeated removal must leave unrelated registrations unchanged.'
    Assert-Check ((Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupSiblingName) -ceq 'preserve unrelated startup') 'Repeated removal must leave unrelated startup entries unchanged.'

    $null = New-ItemProperty -LiteralPath $registryStartupKey -Name $registryStartupName -Value 'existing startup owner' -PropertyType String
    Assert-Fails { Assert-SettingsLink } 'An occupied startup value without a protocol owner must be rejected.' 'startup entry is owned by another application'
    Assert-Fails { Register-SettingsLink $expectedCustomDestination } 'Registration must not overwrite an occupied startup value.' 'startup entry is owned by another application'
    Assert-Check (-not (Test-Path -LiteralPath $registryFixtureKey)) 'A startup collision must fail before creating the protocol registration.'
    Remove-SettingsLink
    Assert-Check ((Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupName) -ceq 'existing startup owner') 'Removal without protocol ownership must preserve an occupied startup value.'
    $null = New-Item -Path $registryFixtureKey
    $null = New-ItemProperty -LiteralPath $registryFixtureKey -Name 'GridWallpaperManaged' -Value 1 -PropertyType DWord
    Assert-Fails { Assert-SettingsLink } 'Protocol ownership alone must not claim an existing startup entry.' 'startup entry is owned by another application'
    Assert-Fails { Register-SettingsLink $expectedCustomDestination } 'Registration must require the warm-start ownership marker for an existing startup entry.' 'startup entry is owned by another application'
    Assert-Fails { Remove-SettingsLink } 'Removal must reject an existing startup entry without the warm-start ownership marker.' 'startup entry is owned by another application'
    $null = New-ItemProperty -LiteralPath $registryFixtureKey -Name 'GridWallpaperWarmStartManaged' -Value 0 -PropertyType DWord
    Assert-Fails { Register-SettingsLink $expectedCustomDestination } 'A zero warm-start ownership marker must reject an occupied startup entry.' 'startup entry is owned by another application'
    Assert-Check ((Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupName) -ceq 'existing startup owner') 'Warm-start ownership collisions must preserve the existing command.'
    Assert-Check ((Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupSiblingName) -ceq 'preserve unrelated startup') 'Warm-start ownership collisions must preserve unrelated startup entries.'
    Assert-Check (-not (Test-Path -LiteralPath $commandKey)) 'Warm-start ownership collisions must not create a protocol command.'
    $null = Remove-ItemProperty -LiteralPath $registryStartupKey -Name $registryStartupName
    Register-SettingsLink $expectedCustomDestination
    Assert-Check ((Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupName) -ceq $expectedWarmCommand) 'An owned protocol with no startup entry must upgrade to managed warm startup.'
    Remove-SettingsLink
    Assert-Check (-not (Test-Path -LiteralPath $registryFixtureKey)) 'Removal after a warm-start upgrade must remove the owned protocol.'
    Assert-Check ($null -eq (Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupName, $null)) 'Removal after a warm-start upgrade must remove its startup value.'
    Assert-Check ((Get-Item -LiteralPath $registryStartupKey).GetValue($registryStartupSiblingName) -ceq 'preserve unrelated startup') 'Upgrade and removal must preserve unrelated startup entries.'
    Write-Output 'PASS warm-start ownership collisions, upgrade, and exact removal'

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
    if ($flatModule) { Remove-Module -ModuleInfo $flatModule -Force }
    if ($module) { Remove-Module -ModuleInfo $module -Force }
    if ($registryFixturesReserved) {
        foreach ($registryPath in @($registryFixtureKey, $registrySiblingKey, $registryStartupKey)) {
            if (-not (Test-Path -LiteralPath $registryPath)) { continue }
            $registryItem = Get-Item -LiteralPath $registryPath
            $expectedRegistryName = $registryPath.Replace('HKCU:', 'HKEY_CURRENT_USER')
            $expectedRegistryRoot = 'HKEY_CURRENT_USER\Software\Classes\grid-wallpaper-test-' + $registryFixtureId
            if ($registryFixtureId -cnotmatch '^[a-f0-9]{32}$' -or
                $registryItem.Name -cne $expectedRegistryName -or
                ($registryItem.Name -cne $expectedRegistryRoot -and $registryItem.Name -cne ($expectedRegistryRoot + '-unrelated') -and
                    $registryItem.Name -cne ($expectedRegistryRoot + '-startup'))) {
                throw 'Refusing to clean a registry key outside the exact GUID-owned test registrations.'
            }
            $registryItem.Dispose()
            Remove-Item -LiteralPath $registryPath -Recurse -Force
        }
    }
    foreach ($junctionFixture in @(
        @{ Path = $configJunctionPath; Relative = 'linked-host-config\windows-host.json' },
        @{ Path = $sourceJunctionPath; Relative = 'flat-release\wallpaper' },
        @{ Path = $retiredJunctionPath; Relative = 'linked-retired-runtime\grid-native-settings.js' }
    )) {
        if (-not (Test-Path -LiteralPath $junctionFixture.Path)) { continue }
        $junctionItem = Get-Item -LiteralPath $junctionFixture.Path -Force
        $expectedJunctionPath = Join-Path (Join-Path $fixtureParent $fixtureName) $junctionFixture.Relative
        if ([IO.Path]::GetFullPath($junctionItem.FullName) -cne [IO.Path]::GetFullPath($expectedJunctionPath) -or
            -not $junctionItem.FullName.StartsWith($fixtureDirectory + '\', [StringComparison]::OrdinalIgnoreCase) -or
            -not ($junctionItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Refusing to clean a junction outside the exact test fixture path.'
        }
        [IO.Directory]::Delete($junctionFixture.Path)
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
