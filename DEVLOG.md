# Decisions

## 2026-09-13 — Runtime and Windows installation foundation

- Separated canonical configuration, Canvas rendering and native settings UI. Removed the unfinished duplicate page, remote font dependency and documentation of a nonexistent dent feature.
- Replaced overlapping animation loops with one cancellable scheduler, fixed-step simulation, frozen redraw invalidation and Lively pause handling. Shared typed vertex/glow buffers and per-dome calculations reduce repeated work. The default limit is 30 fps; CSS-pixel rendering bounds high-DPI allocation cost.
- Replaced fake loading and value-changing slider animations with native accessible controls; browser storage is validated and Lively Customize owns persistent desktop settings.
- Selected Lively after checking native Windows, Lively and Wallpaper Engine capabilities. The native CLI's project-library constraint requires a small allowlisted install adapter; its replacement condition and current procedures are in OPERATIONS.md.
- Local validation and native GitHub issue evidence replace unapproved hosted execution. Public-release review is a separate gate; private development does not authorize a visibility change.
