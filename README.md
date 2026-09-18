# Grid Wallpaper

An offline animated grid for Windows, with wandering domes, mouse interaction, eight color themes and responsive desktop controls. Powered by [Lively Wallpaper](https://www.rocksdanister.com/lively/).

![Animated Grid Wallpaper preview](https://github.com/gagexhill/grid-wallpaper/blob/main/wallpaper/preview.gif?raw=true)

**[Download the Windows preview](https://github.com/gagexhill/grid-wallpaper/releases)**

Requires **x64 Windows 10/11** and **Lively Wallpaper**. Setup can install Lively for you. The custom desktop panel supports Lively's default **WebView2** player and **per-screen layout on the primary display**. Other arrangements can use Lively's native Customize command.

This is a preview release. [Laptop acceptance](https://github.com/gagexhill/grid-wallpaper/issues/1) records the completed checks; [open issues](https://github.com/gagexhill/grid-wallpaper/issues) track release finishing and known limitations, including the untested [display hotplug](https://github.com/gagexhill/grid-wallpaper/issues/30).

## Install on Windows

1. Open [Releases](https://github.com/gagexhill/grid-wallpaper/releases), expand **Assets** on the newest preview if needed, and download **grid-wallpaper-windows.zip**. Choose this file rather than the **Source code** archives.
2. In File Explorer, right-click the downloaded ZIP, choose **Extract All**, then **Extract**. Open the extracted folder containing `install.ps1`.
3. Click File Explorer's address bar, type `powershell`, and press **Enter**. A PowerShell window opens in that folder.
4. Paste this command into PowerShell and press **Enter**:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
   ```

Setup installs Lively through Windows Package Manager if needed, checks the wallpaper files and opens the wallpaper. **If Lively shows its first-run wizard, finish it and run the same command again.** Then show your desktop: you should see the moving grid and its settings button.

No Git, Node.js, wallpaper account or server setup is required. Internet is needed only for downloads and missing prerequisites; the wallpaper itself runs offline. Each release includes a SHA256 checksum for the ZIP. Add `-Preview` to the command above for a setup check that makes no changes.

## Update or remove

**Update:** download and extract a newer release, then run the same installation command. Saved customization is preserved. To roll back, run the installer from a previously downloaded MIT-licensed release (preview 5 or later).

**Remove:** open PowerShell in the extracted package folder as above, then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -RemoveSettingsLink
```

This stops the custom settings helper and removes its settings link and startup entry while preserving settings. Next, remove Grid Wallpaper from Lively's library; that step also deletes its saved wallpaper customization. You can keep Lively for other wallpapers. Keep the extracted package until removal is complete.

## Help

- **`install.ps1` cannot be found:** extract the ZIP first, then open PowerShell from the folder that contains `install.ps1`.
- **Setup asks you to finish Lively setup:** complete its wizard, open Lively, and rerun the install command.
- **Windows Package Manager / WinGet is missing:** install or update Microsoft's [App Installer](https://learn.microsoft.com/en-us/windows/package-manager/winget/), reopen PowerShell and retry.
- **Other problems or suggestions:** [open an issue](https://github.com/gagexhill/grid-wallpaper/issues/new) with your Windows/Lively versions and the error text. Remove personal paths or other private information first. Report vulnerabilities through [private security reporting](https://github.com/gagexhill/grid-wallpaper/security/advisories/new).

[OPERATIONS.md](OPERATIONS.md#install-update-and-remove) has detailed setup, troubleshooting and recovery procedures.

## Make it yours

Click the grid button to open the custom settings panel above desktop shortcuts. Dragging the button moves an open panel with it. Click outside, click the button again, or press Escape to close. Controls save through Lively, and decorative animations respect reduced-motion preferences.

Choose a color theme, tune grid and dome motion, enable mouse effects, or freeze a frame. Automatic dome-size sliders show live values; focus a slider to edit its base size, then move focus away to resume the live readout. Lowering the frame limit reduces rendering work without changing animation speed. Lively owns startup, fullscreen and battery playback policies.

For a browser preview, open `grid-wallpaper.html` in the extracted installation package.

## License

Grid Wallpaper is [MIT licensed](LICENSE.txt), copyright 2026 gagexhill. You may use, modify and redistribute it, including commercially, while keeping the license and copyright notice. The packaged WebView2 SDK libraries retain their separate redistribution notice.

## Develop

Use the Node.js version in [.node-version](.node-version) and Microsoft Edge on Windows. With fnm configured, run `fnm use --install-if-missing` from the repository root to install or select it. From a source checkout:

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
