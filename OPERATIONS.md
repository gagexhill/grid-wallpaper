# Operations

## Runtime and ownership

`grid-wallpaper.html` loads local CSS, canonical `grid-config.js`, the Canvas renderer and the settings UI in that order. There are no network requests or runtime package dependencies. GitHub issues track current work; [delivery #1](https://github.com/gagexhill/grid-wallpaper/issues/1) owns laptop acceptance and [privacy #6](https://github.com/gagexhill/grid-wallpaper/issues/6) gates public release.

`grid-config.js` owns browser defaults, ranges and presets. `scripts/lively-properties.cjs` generates the checked-in JSON that Lively requires. Lively stores native customization per display. Its one-way property API cannot save edits made in the wallpaper panel, so the UI describes those as previews. Browser settings use validated local storage; unavailable storage leaves a usable session with an explicit notice.

## Validate

Use the lockfile with `npm ci`, then run one completed command at a time:

```powershell
npm run check
npm run test:browser
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Preview
npm run package
```

Node's built-in tests cover lifecycle and settings regressions. Playwright uses installed Edge, one worker and no retries; browser screenshots and traces are ignored runtime evidence under `test-results/`. They prove browser rendering only. `npm run generate` refreshes native properties after canonical configuration changes. `npm run check` fails when the generated JSON drifts.

Repository Actions must not execute without separate Owner authorization. Before publication, inspect `gh api repos/gagexhill/grid-wallpaper/actions/permissions` and workflows. Dependency metadata does not authorize runner execution.

## Install, update and remove

The entry command is in README. `install.ps1 -Preview` changes nothing; `-SkipLaunch` prepares/copies files without opening Lively or changing the active wallpaper. The installer honors Lively's native library setting and verifies copied hashes. A successful CLI submission is not evidence that desktop playback rendered correctly.

Run the same installer from a new extracted package to update. It retains Lively's separate saved customization. Complete Lively's first-run wizard when requested. If WinGet is absent, install/update Microsoft's App Installer, reopen PowerShell, and rerun. If another wallpaper already occupies the intended target, the installer stops instead of overwriting it.

Use Lively's library to remove Grid Wallpaper or select another wallpaper. Uninstall Lively through Windows Installed apps only if it is no longer wanted. There is no custom service, scheduled task, background updater or global execution-policy change to undo.

To roll back, retain a previously reviewed release package and rerun its installer. Do not delete the library or host saved settings as a troubleshooting shortcut.

## Native acceptance

Record exact source commit, package SHA256, Windows/Lively versions, display configuration, and evidence in #1. Check installation on a clean extracted package; activation behind desktop icons; native Customize changes surviving a complete Lively exit/relaunch; second install; restart/sign-in restoration; sleep/wake; display resolution, scaling and hotplug; fullscreen and battery pause; and recovery when the host restarts. Do not claim hardware battery performance from a browser benchmark. Native host settings own playback and startup policy.

## Packaging and privacy

`wallpaper-files.json` owns the runtime file allowlist used by the installer and packager. `scripts/package.ps1` writes the zip and SHA256 under ignored `dist/`. It excludes Git history, developer dependencies, tests, screenshots and local state. The Windows npm packaging command clears only its child process's inherited `PSModulePath`, allowing Windows PowerShell to resolve its own modules when called through npm from PowerShell 7. This addresses Microsoft's [documented module-path inheritance behavior](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath).

Inspect extracted contents before sharing. Keep visibility private until #6 is accepted and public publication is explicitly authorized. History rewrites or credential rotation require an exact remediation plan; never copy sensitive values into tracking comments.

## Host selection

Windows' documented desktop-wallpaper API manages images/slideshows; it is not a Canvas host. Lively is the selected maintained host because it supports HTML, persistent native properties, pause events, WinGet installation and laptop policies without a paid dependency. Wallpaper Engine supports web wallpapers and similar pause policies but adds a purchase/distribution dependency and offers no demonstrated advantage for this renderer.

The small installer adapter is needed because stable Lively `setwp` accepts project folders inside its configured library, while its media importer does not import raw HTML projects. It reads native settings, copies an allowlisted project, and invokes native commands; it does not duplicate the host. Replace that copy step when a reliable native arbitrary-project import command becomes available.

Official references: [Windows wallpaper API](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-idesktopwallpaper), [Lively CLI](https://github.com/rocksdanister/lively/wiki/Command-Line-Controls), [Lively properties](https://github.com/rocksdanister/lively/wiki/Web-Guide-IV-:-Interaction), [web player and cache](https://github.com/rocksdanister/lively/wiki/Web-Player), [pause events](https://github.com/rocksdanister/lively/wiki/Web-Guide-V-:-System-Data), [laptop performance policies](https://github.com/rocksdanister/lively/wiki/Performance), [Wallpaper Engine](https://www.wallpaperengine.io/en).
