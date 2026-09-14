# Grid Wallpaper

- This repository owns the offline Canvas runtime and Windows installation package. It must run without adjacent checkouts, personal tooling, a server or Node.js on the receiving laptop.
- `grid-config.js` owns defaults, numeric limits, presets and the settings link. `LivelyProperties.json` and `windows-integration.json` are generated metadata: run `npm run generate` and validate parity instead of editing them directly.
- `grid-wallpaper.js` owns simulation, rendering, validated browser persistence and Lively callbacks. `grid-settings.js` and `grid-wallpaper.css` own the settings UI.
- Preserve that custom panel on the desktop. `windows/settings-window.cs` hosts the same HTML above desktop shortcuts, anchors its top-right corner to the settings button's center within the display work area, and clips the native window to the CSS corner radius. Do not replace the panel with Lively's generated editor.
- Opening and closing must be responsive. Reuse the warmed WebView2 control, suspend it while hidden after saving, and end its lifetime with Lively. The installer owns its reversible native per-user warm-start entry. `grid-native-settings.js` bridges validated changes to Lively; acknowledge saves only after native persistence is confirmed.
- `scripts/build-settings.ps1` owns the pinned official WebView2 SDK and native build. Package its required redistribution license. `windows-host.json` contains installed-machine paths and must remain local and excluded from packages and Git.
- `scripts/thumbnail.cjs` renders the checked-in library thumbnail and animated preview from the runtime. Regenerate with `npm run thumbnail` when their appearance changes; native metadata and the package allowlist must include both.
- Preserve the single animation scheduler, frozen redraw, bounded resume timing and native host pause behavior. Runtime/browser checks and actual Windows desktop acceptance prove different things.
- Use `OPERATIONS.md` for validation, package, install and rollback procedures. Native GitHub issues own remaining work; #1 tracks delivery and #6 gates a future public release.
- No GitHub Actions runner minutes are authorized. Run native local checks and verify repository automation before pushing. Do not enable or dispatch workflows.
- Keep repository visibility private. Public release requires the privacy/security review in #6 and explicit Owner authorization. Do not copy nonpublic identities or sensitive findings into source, logs, issues or artifacts.
- Company operating policy is owned by `ventryn-cloud/STANDARDS.md`. Keep this repository self-contained and record only its runtime and release-specific requirements here.
