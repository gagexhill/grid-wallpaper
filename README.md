# Grid Wallpaper

An offline animated grid with wandering distortions, mouse interaction, eight color themes and adjustable motion. Windows desktop playback uses Lively Wallpaper. Browser preview works by opening `grid-wallpaper.html` directly.

## Install on Windows

Download and extract the Grid Wallpaper package, open PowerShell in that folder, then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

This uses Windows Package Manager to install Lively if needed, copies the wallpaper into its native library, and requests activation. Complete Lively's first-run setup if prompted, then rerun the same command. No Git, Node.js, developer setup, account for the wallpaper, or server configuration is required. Internet is needed only to obtain the package and any missing Lively prerequisites.

For a read-only plan, add `-Preview`. Existing Lively installations and custom library locations are supported. See [operations](OPERATIONS.md) for troubleshooting, updates and removal.

Click the grid's settings button to open its custom panel above desktop shortcuts. Its top-right corner meets the button's center, with placement kept clear of the taskbar. Click the button again, use the close control, or press Escape to hide it. Changes save through Lively. In a normal browser, the same panel saves locally when browser storage is available. Lively owns start at sign-in and pause-on-battery behavior.

Setup warms the settings panel so the button opens it directly. While hidden, it finishes pending saves and suspends the embedded browser. A per-user startup entry prepares it after sign-in when Lively is running; it does not start Lively or change Lively's startup preference. When Lively exits, the browser and button close; a small helper waits for Lively to return.

The desktop panel supports the primary display with Lively's default WebView2 player and per-screen layout. For other display arrangements or the optional Chromium player, use Lively's **Customize wallpaper** command. The Windows package targets x64 Windows 10/11.

The default frame limit is 30 fps. Animation speed stays the same when you lower the frame limit. Freeze Frame preserves the image and still redraws when settings or display dimensions change.

With automatic dome sizing enabled, the dome sliders show current sizes. Focus a slider to edit its base size; move focus away to resume its live readout. The desktop readout uses a private connection within this computer and sends no data to the internet.

## Develop and validate

From a source checkout on Windows, use Node.js 22 or newer and Microsoft Edge, then:

```powershell
npm ci
npm run check
npm run test:browser
npm run test:install
npm run package
```

Only development checks require npm. Packaging compiles the small settings window using Windows' .NET Framework compiler and a pinned official WebView2 SDK; its first build needs internet access. Runtime defaults and presets live in `grid-config.js`; the renderer, settings UI and installation each have one source owner. In a source checkout, `AGENTS.md` provides editing guidance. See [OPERATIONS.md](OPERATIONS.md) for release evidence.
