# Grid Wallpaper

An offline animated grid for Windows, with wandering domes, mouse interaction, eight color themes and responsive desktop controls. Powered by [Lively Wallpaper](https://www.rocksdanister.com/lively/).

![Animated Grid Wallpaper preview](https://github.com/gagexhill/grid-wallpaper/blob/main/wallpaper/preview.gif?raw=true)

## Install on Windows

1. Open [Releases](https://github.com/gagexhill/grid-wallpaper/releases) and download **grid-wallpaper-windows.zip** from the newest preview. The automatically generated **Source code** archives are for development.
2. Extract the ZIP and open PowerShell in the extracted folder.
3. Run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
   ```

Setup installs Lively through Windows Package Manager if needed, verifies the wallpaper files and opens the wallpaper. Complete Lively's first-run wizard if prompted, then rerun the command. No Git, Node.js, wallpaper account or server setup is required. Internet is needed only for downloads and missing prerequisites; the wallpaper itself runs offline.

The release includes a SHA256 checksum for the ZIP. Add `-Preview` to the installation command for a read-only setup check. To update, extract a newer release and run the same command; saved customization is preserved. See [OPERATIONS.md](OPERATIONS.md) for troubleshooting, removal and rollback.

## Make it yours

Click the grid button to open the custom settings panel above desktop shortcuts. Dragging the button moves an open panel with it. Click outside, click the button again, or press Escape to close. Controls save through Lively, and decorative animations respect reduced-motion preferences.

Choose a color theme, tune grid and dome motion, enable mouse effects, or freeze a frame. Automatic dome-size sliders show live values; focus a slider to edit its base size, then move focus away to resume the live readout. Lowering the frame limit reduces rendering work without changing animation speed. Lively owns startup, fullscreen and battery playback policies.

The Windows package supports **x64 Windows 10/11**, Lively's default **WebView2** player, and its **per-screen layout on the primary display**. Use Lively's native Customize command for other arrangements or the optional Chromium player. Browser preview is available by opening `grid-wallpaper.html` in the extracted installation package.

Builds are currently previews. Remaining restart, sleep, power and display-transition acceptance is tracked in [#1](https://github.com/gagexhill/grid-wallpaper/issues/1); browser tests do not establish those device behaviors.

## Develop

Use Node.js 22 or newer and Microsoft Edge on Windows. From a source checkout:

```powershell
npm ci
npm run check
npm run test:browser
npm run test:install
npm run package
```

Open `wallpaper/grid-wallpaper.html` for source preview. Packaging builds the native settings helper using Windows' .NET Framework compiler and a pinned official WebView2 SDK; its first build downloads that SDK. The ready-to-install ZIP and checksum are written to `dist/`.

| Location | Purpose |
|---|---|
| `wallpaper/` | Browser runtime, canonical settings, Lively metadata and preview assets |
| `windows/` | Native desktop settings host and local telemetry |
| `scripts/` | Metadata generation, previews, native build and packaging |
| `tests/` | Runtime, browser and installer checks |
| `install.ps1` / `wallpaper-files.json` | Setup entry point and distribution allowlist |

The installed package stays flat; the source folders are only for development. [OPERATIONS.md](OPERATIONS.md) owns validation and release procedures; `AGENTS.md` contains source-editing guidance.
