# Grid Wallpaper

- This repository owns the offline Canvas runtime and Windows installation package. It must run without adjacent checkouts, personal tooling, a server or Node.js on the receiving laptop.
- `grid-config.js` owns defaults, numeric limits and presets. `LivelyProperties.json` is generated native metadata: run `npm run generate` and validate parity instead of editing it directly.
- `grid-wallpaper.js` owns simulation, rendering, validated browser persistence and Lively callbacks. `grid-settings.js` and `grid-wallpaper.css` own the settings UI.
- Preserve the single animation scheduler, frozen redraw, bounded resume timing and native host pause behavior. Runtime/browser checks and actual Windows desktop acceptance prove different things.
- Use `OPERATIONS.md` for validation, package, install and rollback procedures. Native GitHub issues own remaining work; #1 tracks delivery and #6 gates a future public release.
- No GitHub Actions runner minutes are authorized. Run native local checks and verify repository automation before pushing. Do not enable or dispatch workflows.
- Keep repository visibility private. Public release requires the privacy/security review in #6 and explicit Owner authorization. Do not copy nonpublic identities or sensitive findings into source, logs, issues or artifacts.
- Company operating policy is owned by Ventryn's control-plane standards. Keep this repository self-contained and record only its runtime and release-specific requirements here.
