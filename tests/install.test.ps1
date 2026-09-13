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
    $null = [IO.Directory]::CreateDirectory($fixtureDirectory)
    $packageDirectory = Join-Path $fixtureDirectory 'package'
    $normalDataDirectory = Join-Path $fixtureDirectory 'normal-data'
    $storeDataDirectory = Join-Path $fixtureDirectory 'store-data'
    $null = [IO.Directory]::CreateDirectory($packageDirectory)

    $parseTokens = $null
    $parseErrors = $null
    $installerAst = [Management.Automation.Language.Parser]::ParseFile($installerPath, [ref]$parseTokens, [ref]$parseErrors)
    Assert-Check ($parseErrors.Count -eq 0) 'The installer must parse in Windows PowerShell 5.1.'
    $helperNames = @('Get-LivelyState', 'Assert-Destination', 'Copy-Runtime')
    $helperDefinitions = foreach ($helperName in $helperNames) {
        $helperMatches = @($installerAst.FindAll({
            param($node)
            $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $helperName
        }, $false))
        Assert-Check ($helperMatches.Count -eq 1) ('Expected one installer helper: ' + $helperName)
        $helperMatches[0].Extent.Text
    }
    $normalDataLiteral = "'" + $normalDataDirectory.Replace("'", "''") + "'"
    $runtimeLiterals = @($runtimeNames | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', '
    $moduleText = '$ErrorActionPreference = ''Stop''' + "`n" +
        'Set-StrictMode -Version 2.0' + "`n" +
        '$normalDataDirectory = ' + $normalDataLiteral + "`n" +
        '$runtimeFiles = @(' + $runtimeLiterals + ')' + "`n" +
        ($helperDefinitions -join "`n`n")
    $modulePath = Join-Path $packageDirectory 'installer-fixture.psm1'
    Write-Fixture $modulePath $moduleText
    foreach ($runtimeName in $runtimeNames) {
        Write-Fixture (Join-Path $packageDirectory $runtimeName) ('fixture: ' + $runtimeName)
    }
    Write-Fixture (Join-Path $packageDirectory 'LivelyInfo.json') $metadataText
    Write-Fixture (Join-Path $packageDirectory 'unlisted-note.txt') 'This must never be copied.'
    $module = Import-Module -Name $modulePath -PassThru -Force -DisableNameChecking
    $lively = [pscustomobject]@{ DataDirectory = $normalDataDirectory; Store = $false }
    $settingsPath = Join-Path $normalDataDirectory 'Settings.json'

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
    foreach ($runtimeName in $runtimeNames) {
        Assert-Check ((Get-FileHash -LiteralPath (Join-Path $expectedCustomDestination $runtimeName)).Hash -ceq
            (Get-FileHash -LiteralPath (Join-Path $packageDirectory $runtimeName)).Hash) ('Installed runtime bytes differ: ' + $runtimeName)
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

    Write-Output ('Installer regression checks passed: ' + $assertionCount + ' assertions. No installed applications or native settings were touched.')
} finally {
    if ($module) { Remove-Module -ModuleInfo $module -Force }
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
