# Decisions

## 2026-09-13 — Runtime and Windows installation foundation

- Separated canonical configuration, Canvas rendering and native settings UI. Removed the unfinished duplicate page, remote font dependency and documentation of a nonexistent dent feature.
- Replaced overlapping animation loops with one cancellable scheduler, fixed-step simulation, frozen redraw invalidation and Lively pause handling. Shared typed vertex/glow buffers and per-dome calculations reduce repeated work. The default limit is 30 fps; CSS-pixel rendering bounds high-DPI allocation cost.
- Replaced fake loading and value-changing slider animations with native accessible controls; browser storage is validated and Lively Customize owns persistent desktop settings.
- Selected Lively after checking native Windows, Lively and Wallpaper Engine capabilities. The native CLI's project-library constraint requires a small allowlisted install adapter; its replacement condition and current procedures are in OPERATIONS.md.
- Local validation and native GitHub issue evidence replace unapproved hosted execution. Public-release review is a separate gate; private development does not authorize a visibility change.
- Native setup exposed partial first-launch settings and cached library tiles. Setup now waits for the configured library before copying and refreshes the native library window after metadata changes. A rendered thumbnail and concise description identify the wallpaper in Lively.
- Settings placement uses the host display work area with a 16 px gap around system UI. Opening and closing animates the settings glyph while preserving the control hit area and reduced-motion behavior.
- Preserved the custom settings panel after the native generated editor was rejected. A temporary WebView2 window puts the existing panel above desktop shortcuts with normal foreground behavior; Lively retains saved-property ownership. The installed-only host configuration stays out of distribution artifacts.
- Added the looping library preview and reduced playback to half speed while retaining the concise description and rendered still thumbnail.
- Native acceptance caught a file-URI compatibility error that returned HTTP 403 for the panel itself. The host explicitly targets .NET Framework 4.8, uses a plain local document URI, and selects settings mode only through its injected flag; a URI regression check protects the resource boundary.
- Anchored the panel's top-right corner to the settings button center and clipped the native window to the CSS rounding. The helper now reuses a suspended WebView2 control instead of recreating it on every click. An owned per-user warm-start entry prepares it with Lively; closing hides immediately, pending saves finish before suspension, and the helper exits with the host. Native warm opening reached interactive controls in 233–411 ms on the acceptance machine.
