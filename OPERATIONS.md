# Operations

## Runtime and ownership

`grid-wallpaper.html` loads local CSS, canonical `grid-config.js`, the Canvas renderer, the optional native bridge and the settings UI in that order. The web runtime makes no network requests and requires no npm dependencies. The desktop panel ships the official WebView2 SDK libraries and uses the installed Microsoft runtime. GitHub issues track current work; [delivery #1](https://github.com/gagexhill/grid-wallpaper/issues/1) owns laptop acceptance and [privacy #6](https://github.com/gagexhill/grid-wallpaper/issues/6) gates public release.

`grid-config.js` owns browser defaults, ranges, presets and host link metadata. `scripts/lively-properties.cjs` generates the checked-in native JSON. Lively stores customization per display. The custom desktop window persists through native CLI commands; inline controls in the optional Chromium wallpaper player are session previews because its property callback is one-way. Browser settings use validated local storage; unavailable storage leaves a usable session with an explicit notice.

## Validate

Use the lockfile with `npm ci`, then run one completed command at a time:

```powershell
npm run check
npm run test:browser
npm run test:install
npm run build:settings
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Preview
npm run package
```

Node's built-in tests cover lifecycle and settings regressions. Playwright uses installed Edge, one worker and no retries; browser screenshots and traces are ignored runtime evidence under `test-results/`. They prove browser rendering only. Windows PowerShell tests exercise installer functions in isolated temporary fixtures without launching or modifying Lively. `npm run generate` refreshes native properties after canonical configuration changes. `npm run check` fails when the generated JSON drifts.

Repository Actions must not execute without separate Owner authorization. Before publication, inspect `gh api repos/gagexhill/grid-wallpaper/actions/permissions` and workflows. Dependency metadata does not authorize runner execution.

## Install, update and remove

The entry command is in README. `install.ps1 -Preview` changes nothing; `-SkipLaunch` prepares/copies files without opening Lively or changing the active wallpaper. The installer honors Lively's native library setting and verifies copied hashes. A successful CLI submission is not evidence that desktop playback rendered correctly.

Run the same installer from a new extracted package to update. It retains Lively's separate saved customization and waits for a readable native library location before copying files. If startup does not finish in time, setup exits with code 2 and can be rerun. `-SkipLaunch` also returns 2 when Lively has not initialized its library yet. Complete Lively's first-run wizard when requested. If WinGet is absent, install/update Microsoft's App Installer, reopen PowerShell, and rerun. If another wallpaper already occupies the intended target, the installer stops instead of overwriting it.

When the thumbnail or metadata changes, setup closes and reopens Lively's library window through native commands so its cached tile updates. The wallpaper core remains running. If the window takes too long to close, reopen it from Lively's tray icon.

Use Lively's library to remove Grid Wallpaper or select another wallpaper. Uninstall Lively through Windows Installed apps only if it is no longer wanted. There is no custom service, scheduled task, background updater or global execution-policy change to undo.

The installer registers a per-user settings link to the fixed installed `grid-settings.exe --uri` command. Its parser accepts only the canonical scheme, the open action, and bounded normalized button coordinates; it never interprets URI input as a command or filesystem path. A fixed `--warm` command in Windows' per-user Run key prepares the same host after sign-in. Registration preserves unrelated Run values. Run `install.ps1 -RemoveSettingsLink` to stop the helper and remove both owned registrations. Setup writes machine-specific paths only to the installed `windows-host.json`; that file is excluded from source and packages. The host uses a local WebView2 profile under LocalAppData's `Grid Wallpaper` directory. Updates ask it to flush and exit before replacing files.

The custom settings panel supports the primary display in Lively's per-screen layout. It uses the same HTML and controls as browser preview, with a borderless normal window and a 16 DIP working-area margin. The panel's top-right corner aligns with the button's center where the work area permits, and its native region matches the CSS radius. It does not remain always on top. It validates changes against native property metadata, coalesces slider input, calls native `setprop`, and checks the exact saved value before displaying confirmation. Use Lively's native Customize command for other arrangements or the optional Chromium player.

Closing hides the panel immediately; it finishes pending saves and suspends WebView2 while hidden. Opening reuses that control and refreshes native settings without discarding pending edits. Save failure brings the panel back with an explicit error. The warm entry waits a bounded interval for Lively to initialize and exits silently if unavailable; it never starts Lively. The helper exits with the verified Lively process. This trades retained suspended memory for responsive controls while the wallpaper host is active. Follow Microsoft's [WebView2 performance guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/performance) when changing this lifecycle.

Setup waits up to 15 seconds for the panel to become ready. For diagnostics, the installed helper's `--status` command emits a local JSON snapshot of readiness, visibility, suspension and physical window/work-area geometry. `--self-test` checks value validation, URI boundaries and anchor calculations; `--close` flushes and exits the helper for updates. Neither diagnostics command changes wallpaper settings.

To roll back, retain a previously reviewed release package and rerun its installer. Do not delete the library or host saved settings as a troubleshooting shortcut.

## Native acceptance

Record exact source commit, package SHA256, Windows/Lively versions, display configuration, and evidence in #1. Check installation on a clean extracted package; activation behind desktop icons; native Customize changes surviving a complete Lively exit/relaunch; second install; restart/sign-in restoration; sleep/wake; display resolution, scaling and hotplug; fullscreen and battery pause; and recovery when the host restarts. Do not claim hardware battery performance from a browser benchmark. Native host settings own playback and startup policy.

## Packaging and privacy

`wallpaper-files.json` owns the runtime file allowlist used by the installer and packager. `scripts/package.ps1` writes the zip and SHA256 under ignored `dist/`. It excludes Git history, developer dependencies, tests, screenshots and local state. The Windows npm packaging command clears only its child process's inherited `PSModulePath`, allowing Windows PowerShell to resolve its own modules when called through npm from PowerShell 7. This addresses Microsoft's [documented module-path inheritance behavior](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath).

Packaging invokes `scripts/build-settings.ps1`. The build pins Microsoft's WebView2 NuGet SDK, verifies its SHA512 against official metadata, and compiles x64 with Windows' .NET Framework compiler. Outputs and SDK cache stay under `dist/`; the package contains the helper, three required SDK libraries and the SDK license, with no debug symbols or machine configuration. The receiving machine uses the WebView2 Runtime installed with Lively.

Inspect extracted contents before sharing. Keep visibility private until #6 is accepted and public publication is explicitly authorized. History rewrites or credential rotation require an exact remediation plan; never copy sensitive values into tracking comments.

`thumbnail.jpg` and `preview.gif` are reviewed runtime assets, generated with `npm run thumbnail` using Edge and the development-only `gifenc` encoder. The renderer uses a seeded Sage preview with higher line contrast for a readable small tile; these preview settings do not change wallpaper defaults. The GIF loops forward and backward at half the original preview playback speed. Lively plays it automatically in normal library mode and uses the still image in lite mode.

Lively's automatic capture belongs to interactive import and is unavailable to this folder-copy setup. Its private bundled image assemblies are not a supported standalone build API. The small generator uses an established JavaScript encoder so regeneration does not depend on an installed Lively directory or another system tool. Regenerate and visually review both assets after material visual changes. Native desktop captures stay ignored and are never included in the package.

## Host selection

Windows' documented desktop-wallpaper API manages images/slideshows; it is not a Canvas host. Lively is the selected maintained host because it supports HTML, persistent native properties, pause events, WinGet installation and laptop policies without a paid dependency. Wallpaper Engine supports web wallpapers and similar pause policies but adds a purchase/distribution dependency and offers no demonstrated advantage for this renderer.

The small installer adapter is needed because stable Lively `setwp` accepts project folders inside its configured library, while its media importer does not import raw HTML projects. It reads native settings, copies an allowlisted project, and invokes native commands; it does not duplicate the host. Replace that copy step when a reliable native arbitrary-project import command becomes available.

Windows places the wallpaper below desktop shortcuts, so CSS stacking cannot lift a panel above them. Lively's WebView2 player sends user-opened links to Windows, and its generated native editor does not preserve this custom UI. A small window built on Microsoft's official WebView2 WinForms SDK covers that gap while retaining Lively's persistence. It allows only the installed local assets and validates message origin, properties and values. Remove this adapter if Lively provides a reliable native way to host the existing custom panel above icons. The SDK integration follows Microsoft's [WinForms WebView2 guide](https://learn.microsoft.com/en-us/microsoft-edge/webview2/get-started/winforms).

Official references: [Windows wallpaper API](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-idesktopwallpaper), [Lively CLI](https://github.com/rocksdanister/lively/wiki/Command-Line-Controls), [Lively properties](https://github.com/rocksdanister/lively/wiki/Web-Guide-IV-:-Interaction), [web player and cache](https://github.com/rocksdanister/lively/wiki/Web-Player), [pause events](https://github.com/rocksdanister/lively/wiki/Web-Guide-V-:-System-Data), [laptop performance policies](https://github.com/rocksdanister/lively/wiki/Performance), [Wallpaper Engine](https://www.wallpaperengine.io/en).
