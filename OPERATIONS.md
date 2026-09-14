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

The custom settings panel supports the primary display in Lively's per-screen layout. It uses the same HTML and controls as browser preview, with a borderless normal window and a 16 DIP working-area margin. The panel's top-right corner aligns with the button's center where the work area permits; native clipping preserves the CSS rounded border. It does not remain always on top. It validates changes against native property metadata, coalesces slider input, calls native `setprop`, and checks the exact saved value before displaying confirmation. Use Lively's native Customize command for other arrangements or the optional Chromium player.

The desktop button uses a small native window with real mouse capture, so a drag continues outside its bounds without starting Explorer's selection rectangle. Its six press-animation frames are rasterized from the existing CSS and SVG by `grid-native-settings.js`; the native host does not own a second theme or glyph. Its snapped side and vertical position are private local preferences in the existing profile. A normal click toggles the warmed panel in the same process; the registered URI remains available for recovery.

Closing hides the panel immediately; it finishes pending saves and suspends WebView2 after a short hidden grace period for quick repeated toggles. Opening reuses that control and refreshes native settings without discarding pending edits. Save failure brings the panel back with an explicit error. When Lively exits, the browser and launcher are disposed. A lightweight supervisor waits for Lively to return, using low-frequency in-process checks while dormant; it never starts Lively. Native configuration notifications retire the controls when Grid is no longer the supported active wallpaper. Follow Microsoft's [WebView2 performance guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/performance) when changing this lifecycle.

Setup waits up to 15 seconds for the panel to become ready. For diagnostics, the installed helper's `--status` command emits a local JSON snapshot of readiness, visibility, suspension, launcher state and physical window/work-area geometry. `--self-test` checks value validation, URI boundaries and anchor calculations; `--close` flushes and exits the helper for updates. Neither diagnostics command changes wallpaper settings.

To roll back, retain a previously reviewed release package and rerun its installer. Do not delete the library or host saved settings as a troubleshooting shortcut.

## Native acceptance

Record exact source commit, package SHA256, Windows/Lively versions, display configuration and results in #1. Keep captures local and mark each unperformed check open. Run these steps on the installed copy using the primary display, WebView2 player and per-screen layout:

1. Install from a clean extracted package using the README command. Confirm animation behind desktop icons. From the installed wallpaper folder identified by setup, require exit code 0 from `(Start-Process .\grid-settings.exe -ArgumentList '--self-test' -WindowStyle Hidden -Wait -PassThru).ExitCode`; run `.\grid-settings.exe --status | ConvertFrom-Json` for the diagnostic snapshots below.
2. Open the custom panel with the grid button. Confirm it appears above shortcuts, controls respond, and status reports `ready: true`, `visible: true`, `suspended: false`. Record time from click to interactive controls. Check the button's press feedback, close control and Escape. Toggle the button rapidly five times from closed, then close; after pending work settles, require `visible: false` and `suspended: true`. Reopen and confirm responsive controls.
3. Record a numeric setting, change it, and hide the panel immediately. Wait for suspension, reopen, and verify the new value in both the custom panel and Lively's Customize command. Restore the original value the same way. Fully exit Lively, confirm the browser and launcher disappear while the helper becomes dormant, then relaunch and verify saved values and panel recovery. Select another wallpaper and then Grid again; its button must follow Grid's active lifetime.
4. Move the grid button near the display edges and reopen the panel at each position. Drag quickly beyond the button and release outside it; confirm no desktop selection rectangle or continued movement after release. Compare status window bounds with `screen.workArea`; confirm the working-area margin, button anchor and unobscured bottom controls. Visually check all rounded corners against the CSS shape and confirm another foreground app can cover the panel.
5. Record Lively's startup preference and the relevant per-user registrations locally. Reinstall the same package and verify saved values remain. From the extracted package, run the README installer command with `-RemoveSettingsLink` before removing any library files. Confirm the helper exits and only its owned protocol and Run value disappear. Reinstall and confirm those registrations and quick panel opening return; unrelated Run values and Lively's startup preference must remain unchanged.
6. On the receiving laptop, separately record clean setup, Windows restart/sign-in restoration, sleep/wake, resolution and scaling changes, display hotplug, fullscreen pause, and battery pause/resume under the chosen Lively policies. Repeat panel placement and persistence checks after display changes. Leave any unavailable hardware scenario open; desktop or browser checks do not prove laptop behavior or battery performance.

Native host settings own playback and startup policy. Preserve their original values after acceptance.

## Packaging and privacy

`wallpaper-files.json` owns the runtime file allowlist used by the installer and packager. `scripts/package.ps1` writes the zip and SHA256 under ignored `dist/`. It excludes Git history, developer dependencies, tests, screenshots and local state. The Windows npm packaging command clears only its child process's inherited `PSModulePath`, allowing Windows PowerShell to resolve its own modules when called through npm from PowerShell 7. This addresses Microsoft's [documented module-path inheritance behavior](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath).

Packaging invokes `scripts/build-settings.ps1`. The build pins Microsoft's WebView2 NuGet SDK, verifies its SHA512 against official metadata, and compiles x64 with Windows' .NET Framework compiler. Outputs and SDK cache stay under `dist/`; the package contains the helper, three required SDK libraries and the SDK license, with no debug symbols or machine configuration. The receiving machine uses the WebView2 Runtime installed with Lively.

Inspect extracted contents before sharing. Keep visibility private until #6 is accepted and public publication is explicitly authorized. History rewrites or credential rotation require an exact remediation plan; never copy sensitive values into tracking comments.

`thumbnail.jpg` and `preview.gif` are reviewed runtime assets, generated with `npm run thumbnail` using Edge and the development-only `gifenc` encoder. The renderer uses a seeded Sage preview with higher line contrast for a readable small tile; these preview settings do not change wallpaper defaults. The GIF loops forward and backward at half the original preview playback speed. Lively plays it automatically in normal library mode and uses the still image in lite mode.

Lively's automatic capture belongs to interactive import and is unavailable to this folder-copy setup. Its private bundled image assemblies are not a supported standalone build API. The small generator uses an established JavaScript encoder so regeneration does not depend on an installed Lively directory or another system tool. Regenerate and visually review both assets after material visual changes. Native desktop captures stay ignored and are never included in the package.

## Host selection

Windows' documented desktop-wallpaper API manages images/slideshows; it is not a Canvas host. Lively is the selected maintained host because it supports HTML, persistent native properties, pause events, WinGet installation and laptop policies without a paid dependency. Wallpaper Engine supports web wallpapers and similar pause policies but adds a purchase/distribution dependency and offers no demonstrated advantage for this renderer.

The small installer adapter is needed because stable Lively `setwp` accepts project folders inside its configured library, while its media importer does not import raw HTML projects. It reads native settings, copies an allowlisted project, and invokes native commands; it does not duplicate the host. Replace that copy step when a reliable native arbitrary-project import command becomes available.

Windows places the wallpaper below desktop shortcuts, so CSS stacking cannot lift a panel above them. Lively's WebView2 player sends user-opened links to Windows, and its generated native editor does not preserve this custom UI. Its forwarded wallpaper mouse input also leaves Explorer handling the physical desktop click. A small window built on Microsoft's official WebView2 WinForms SDK covers the custom-panel gap; a shell-owned native launcher captures dragging and opens that panel directly. Neither window stays topmost. The adapter allows only installed local assets, validates message origin/properties/values, and retains Lively's persistence. Remove it if Lively provides reliable native hosting and input for the existing panel above icons. The integration follows Microsoft's [WinForms WebView2 guide](https://learn.microsoft.com/en-us/microsoft-edge/webview2/get-started/winforms) and [owned-window rules](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features).

Official references: [Windows wallpaper API](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-idesktopwallpaper), [Lively CLI](https://github.com/rocksdanister/lively/wiki/Command-Line-Controls), [Lively properties](https://github.com/rocksdanister/lively/wiki/Web-Guide-IV-:-Interaction), [web player and cache](https://github.com/rocksdanister/lively/wiki/Web-Player), [pause events](https://github.com/rocksdanister/lively/wiki/Web-Guide-V-:-System-Data), [laptop performance policies](https://github.com/rocksdanister/lively/wiki/Performance), [Wallpaper Engine](https://www.wallpaperengine.io/en).
