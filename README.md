# Grid Wallpaper

An offline animated grid with wandering distortions, mouse interaction, eight color themes and adjustable motion. Windows desktop playback uses Lively Wallpaper. Browser preview works by opening `grid-wallpaper.html` directly.

## Install on Windows

Download and extract the Grid Wallpaper package, open PowerShell in that folder, then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

This uses Windows Package Manager to install Lively if needed, copies the wallpaper into its native library, and requests activation. Complete Lively's first-run setup if prompted, then rerun the same command. No Git, Node.js, developer setup, account for the wallpaper, or web server is required. Internet is needed only to obtain the package and any missing Lively prerequisites.

For a read-only plan, add `-Preview`. Existing Lively installations and custom library locations are supported. See [operations](OPERATIONS.md) for troubleshooting, updates and removal.

In Lively, select **Customize wallpaper** to change settings that survive restarts. The wallpaper's own settings panel is a temporary preview in Lively; in a normal browser it saves locally when browser storage is available. Lively's native settings also own start at sign-in and pause-on-battery behavior.

The default frame limit is 30 fps. Animation speed stays the same when you lower the frame limit. Freeze Frame preserves the image and still redraws when settings or display dimensions change.

## Develop and validate

From a source checkout on Windows, use Node.js 22 or newer and Microsoft Edge, then:

```powershell
npm ci
npm run check
npm run test:browser
npm run test:install
npm run package
```

Only development checks require npm. Runtime defaults and presets live in `grid-config.js`; the renderer, settings UI and installation each have one source owner. See [AGENTS.md](AGENTS.md) for editing guidance and [OPERATIONS.md](OPERATIONS.md) for release evidence.
