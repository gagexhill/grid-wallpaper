# 🖥️ Grid Wallpaper — Preview 6

> *"A desktop wallpaper is the one surface you look at all day and are never allowed to touch. Grid Wallpaper gives it back."*

<br>

<div align="center">

![Grid Wallpaper](https://img.shields.io/badge/Grid%20Wallpaper-1.0.0--preview.6-9ecdb8?style=for-the-badge&logo=windowsterminal&logoColor=white)
![Node](https://img.shields.io/badge/Node-22.23.2-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Canvas](https://img.shields.io/badge/Canvas-2D-e8b89a?style=for-the-badge&logo=html5&logoColor=white)
![C#](https://img.shields.io/badge/C%23-.NET%20Framework-512BD4?style=for-the-badge&logo=dotnet&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-1.63.0-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**Maintained by:** gagexhill  
**Runs on:** x64 Windows 10/11 via [Lively Wallpaper](https://www.rocksdanister.com/lively/)  
**Status:** Preview release — [laptop acceptance](https://github.com/gagexhill/grid-wallpaper/issues/1) records the completed checks

<br>

⬇️ **[Download the Windows preview](https://github.com/gagexhill/grid-wallpaper/releases)** &nbsp;|&nbsp; 🐞 **[Open issues](https://github.com/gagexhill/grid-wallpaper/issues)**

![Animated Grid Wallpaper preview](https://github.com/gagexhill/grid-wallpaper/blob/main/wallpaper/preview.gif?raw=true)

</div>

---

## 📌 Table of Contents

- [Project Overview](#-project-overview)
- [The Problem It Solves](#-the-problem-it-solves)
- [Core Concept: One Frozen Configuration](#-core-concept-one-frozen-configuration)
- [Themes](#-themes)
- [Tech Stack](#-tech-stack)
- [Project Architecture](#-project-architecture)
- [Key Features](#-key-features)
- [How It Works — Under the Hood](#-how-it-works--under-the-hood)
- [Getting Started](#-getting-started)
- [File Structure](#-file-structure)
- [Concepts & References](#-concepts--references)
- [About the Owner](#-about-the-owner)

---

## 🌐 Project Overview

**Grid Wallpaper** is an offline animated desktop background for Windows: a field of grid lines that bends around wandering domes, reacts to the mouse, and is tuned from a settings panel that opens directly on the desktop, above your shortcuts.

This repository owns the whole product — the Canvas runtime that draws it, the native C# host that puts controls on the desktop, the generator that keeps one configuration in sync across three consumers, the PowerShell installer, and the browser, runtime and installer test suites. It is not a Lively theme pack; Lively is the player it runs inside.

It runs entirely offline. The internet is used to download a release and to fetch prerequisites, and never again.

---

## 🔍 The Problem It Solves

An animated wallpaper is normally a dead end. You install it, and then:

- Changing anything means leaving the desktop, opening the wallpaper app, and hunting through its settings tree
- The settings the author exposes are whatever they hard-coded, in whatever order they wrote them
- It renders at full speed whether or not anyone is looking at it
- Its appearance is fixed, so the one thing you stare at all day cannot match what you are doing

Grid Wallpaper puts the controls where the wallpaper is — a button on the desktop that opens a real panel — and derives every control from a single configuration file, so the browser preview, Lively's native property sheet and the desktop panel can never disagree about what exists, what it is called, or what its bounds are.

---

## 🧬 Core Concept: One Frozen Configuration

Everything the wallpaper can do is declared once, in a frozen object in `wallpaper/grid-config.js`. Nothing else is allowed to invent a setting.

```
                    wallpaper/grid-config.js
                 (schema + defaults + presets, frozen)
                              │
                              ▼
                 scripts/lively-properties.cjs
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
   LivelyProperties.json          windows-integration.json
   (Lively's native sheet)        (native host's bounds)
              │                               │
              ▼                               ▼
      Lively saves values ──────────► windows/settings-window.cs
              │                               │
              └──────────────┬────────────────┘
                             ▼
                  wallpaper/grid-wallpaper.js
                     (Canvas render loop)
                             │
                             └──► live telemetry ──► desktop panel readouts
```

**1. Declaration** — `grid-config.js` holds a `schema` of bounds, a `defaults` object, eight `presets` and the host-integration constants, then deep-freezes the lot. It is plain script with no build step, so Node and the browser load the same file.

**2. Generation** — `scripts/lively-properties.cjs` walks `defaults`, infers each control's widget type from its value and schema entry, and writes Lively's native `LivelyProperties.json` plus `windows-integration.json` for the C# host. `npm run check` runs it with `--check` and fails if either file has drifted.

**3. Rendering** — `grid-wallpaper.js` clamps every incoming value back against the same schema, simulates the domes on a fixed timestep, and draws the displaced grid into one Canvas.

**4. Control** — the native host reads the generated bounds, so the desktop panel validates against the same numbers the renderer enforces, and writes changes back through Lively rather than keeping its own copy.

---

## 🎛 Themes

Eight presets ship in `grid-config.js`. Each one sets the palette *and* the motion, so switching theme changes how the grid behaves, not just its colour.

| Theme | Background | Line | Cell | Domes | Speed | Vignette |
|---|---|---|---|---|---|---|
| 🌆 **Dusk** | `#2a1f1f` | `#e8b89a` | 18 | 4 | 0.6 | Yes |
| 🪨 **Slate** | `#1a1f2e` | `#b8c4e8` | 16 | 5 | 0.9 | No |
| 🌿 **Sage** | `#1a2420` | `#9ecdb8` | 20 | 4 | 0.5 | No |
| 🌫 **Ash** | `#1c1c1a` | `#e8e8d8` | 12 | 5 | 1.0 | No |
| 🍇 **Plum** | `#1e1525` | `#d4a8c8` | 18 | 5 | 0.5 | Yes |
| 🏜 **Sand** | `#221e15` | `#d4c08a` | 16 | 4 | 0.8 | No |
| ❄️ **Frost** | `#151a20` | `#c0d8e8` | 12 | 6 | 1.4 | No |
| 🔥 **Ember** | `#1a1510` | `#d4784a` | 18 | 5 | 0.5 | Yes |

Mouse interaction is `repel`, `attract` or `off`. The frame limit is 15, 24, 30 or 60 fps and changes how often the grid is drawn, not how fast it moves.

---

## 🛠 Tech Stack

| Technology | Version | Role |
|---|---|---|
| **Node.js** | 22.23.2 | Generation, syntax checks and the runtime test suite; pinned in `.node-version` |
| **Canvas 2D** | Native | The entire renderer — grid, domes, ripples and glow |
| **Lively Wallpaper** | Any current | Desktop player, property storage and playback policy |
| **WebView2** | SDK 1.0.4191.47 | Hosts the wallpaper document and the settings panel; Lively's default player |
| **C# / .NET Framework** | Roslyn 5.9.0, deterministic | Desktop button, settings panel host and dome telemetry |
| **PowerShell** | 5.1+ | `install.ps1`, packaging and the installer test suite |
| **Windows Package Manager** | App Installer | Installs Lively when it is missing |
| **Playwright** | 1.63.0 | Rendered browser checks |
| **gifenc** | 1.0.3 | Generates the preview GIF from real frames |

---

## 🏗 Project Architecture

```
wallpaper/                      ← everything that ships to the desktop
│
├── grid-config.js              ← frozen schema, defaults, 8 presets (40 lines, no build)
├── grid-wallpaper.js           ← Canvas render loop, dome simulation, telemetry source
├── grid-settings.js            ← the settings UI, shared by browser preview and native panel
├── grid-wallpaper.html/.css    ← document and styling for both surfaces
├── LivelyProperties.json       ← GENERATED native property sheet
└── windows-integration.json    ← GENERATED bounds for the native host

windows/                        ← native desktop integration
│
├── settings-window.cs          ← desktop button, borderless panel, WebView2 lifecycle
├── wallpaper-lifecycle.cs      ← player detection, supervision, startup recovery
└── dome-telemetry.cs           ← loopback WebSocket carrying live dome sizes

scripts/                        ← nothing here ships
│
├── lively-properties.cjs       ← the generator; --check fails the build on drift
├── build-settings.ps1          ← compiles the native host
├── package.ps1                 ← builds the release ZIP and its SHA256
└── thumbnail.cjs               ← renders the preview assets
```

Control flows one way: **Lively owns the saved values**, the native host proposes changes through Lively's `setprop` and verifies the exact saved result before confirming, and the renderer is a subscriber that clamps whatever arrives. The renderer never writes settings, and telemetry never writes settings.

---

## ✨ Key Features

- **Desktop-level settings panel** — A native button sits above your shortcuts. Click it and a borderless panel opens in place; drag the button and an open panel follows it. Click outside, click the button again, or press Escape to close.

- **Generated property sheet** — Lively's native settings and the native host's bounds are both generated from `grid-config.js`. `npm run check` fails if either has drifted, so a control cannot exist on one surface and not another.

- **Eight themes that change behaviour** — Each preset carries motion as well as colour, so a theme switch retunes dome count, speed, displacement and vignette together.

- **Mouse interaction** — Domes repel or attract around the cursor with a squared falloff, or ignore it entirely.

- **Live dome telemetry** — Automatic dome-size sliders show the actual rendered multiplier, streamed from the renderer over a loopback WebSocket at up to 15 fps, and only while that readout is visible. Focus a slider to edit its base size; move focus away and the live readout resumes.

- **Frame limiting that is not a slowdown** — The simulation runs on a fixed timestep and the draw is throttled separately, so lowering the frame limit reduces rendering work without changing how fast anything moves.

- **Stops when nobody is looking** — The loop cancels itself when the document is hidden, when Lively pauses playback, and when Freeze Frame is on. Lively keeps ownership of fullscreen and battery policy.

- **Reduced-motion aware** — Decorative animations respect the operating system's reduced-motion preference.

- **Fully offline, no account, no service** — No server, no telemetry off the machine, no background updater and no scheduled task. Each release ships a SHA256 checksum, and `install.ps1 -Preview` shows what setup would do without changing anything.

---

## ⚙ How It Works — Under the Hood

### Generating the native property sheet

Lively needs its own JSON. Rather than maintain it, the generator infers each widget from the shape of the default value and the schema entry beside it — so adding a setting to `grid-config.js` is the whole change.

```js
for (const [key, value] of Object.entries(defaults)) {
  if (key === 'domeSizes') {
    value.forEach((size, i) => {
      const { min, max, step } = schema.domeSize;
      properties['domeSize' + i] = { type: 'slider', text: 'Dome ' + (i + 1) + ' size', min, max, step, value: size };
    });
  } else if (schema[key]) {
    const { label, min, max, step } = schema[key];
    properties[key] = { type: 'slider', text: label, min, max, step, value };
  } else if (key === 'fpsLimit') properties[key] = { type: 'dropdown', text: 'Frame rate', items: fpsOptions.map(fps => fps + ' fps'), value: fpsOptions.indexOf(value) };
```

### Bending the grid around a dome

Every vertex is displaced once per frame by every dome close enough to matter. The bounding check is squared to avoid a square root on the vertices that fail it, and the push uses a sine lobe so displacement fades to zero at both the dome's centre and its edge.

```js
for (const dome of domes) {
  const dx = gx - dome.x, dy = gy - dome.y, squared = dx * dx + dy * dy, radius = dome.radius;
  if (squared < (radius + 40) ** 2) {
    const distance = Math.sqrt(squared);
    if (waves.length && Math.abs(distance - radius) < 40) edge += (1 - Math.abs(distance - radius) / 40) * 1.2;
    if (distance > 0.01 && distance < radius) {
      const t = distance / radius;
      const push = dome.force * Math.sin(Math.PI * t) * 0.5 * (1 + Math.cos(Math.PI * Math.max(0, (t - 0.4) / 0.6)));
      ox += dx / distance * push; oy += dy / distance * push;
    }
  }
}
```

### Separating simulation from drawing

The accumulator advances the simulation in fixed steps while the draw is gated by the chosen frame interval. This is why the frame limit is a rendering-cost control, not a speed control — and why a hidden or paused wallpaper costs nothing.

```js
function frame(now) {
  rafId = null;
  if (document.hidden || hostPaused) { stop(); return; }
  if (lastTime !== null && !config.snapshot) accumulator += Math.min(100, Math.max(0, now - lastTime));
  lastTime = now;
  const interval = 1000 / config.fpsLimit;
  if (dirty || lastRender === null || now - lastRender >= interval - 0.1) {
    while (!config.snapshot && accumulator + 0.001 >= step) { simulate(); accumulator -= step; }
    draw();
    lastRender = lastRender === null ? now : now - ((now - lastRender) % interval);
  }
  schedule();
}
```

---

## 🚀 Getting Started

### Prerequisites

- x64 Windows 10 or 11
- [Lively Wallpaper](https://www.rocksdanister.com/lively/) — setup installs it through Windows Package Manager if it is missing
- Nothing else. No Git, Node.js, account or server setup is needed to run it.

### Installation

1. Open [Releases](https://github.com/gagexhill/grid-wallpaper/releases), expand **Assets** on the newest preview if needed, and download **grid-wallpaper-windows.zip**. Choose this file rather than the **Source code** archives.
2. Right-click the ZIP in File Explorer, choose **Extract All**, then **Extract**. Open the extracted folder containing `install.ps1`.
3. Click File Explorer's address bar, type `powershell`, and press **Enter**.
4. Paste this and press **Enter**:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Show your desktop: the moving grid and its settings button should be there. Add `-Preview` for a setup check that changes nothing. To update, extract a newer release and run the same command — saved customization is preserved.

> **Note:** If Lively shows its first-run wizard, finish it and run the same command again. If Windows Package Manager is missing, install or update Microsoft's [App Installer](https://learn.microsoft.com/en-us/windows/package-manager/winget/), reopen PowerShell and retry. [OPERATIONS.md](OPERATIONS.md#install-update-and-remove) owns the full setup, update, removal and recovery procedures.

### Build for Production

Use the Node.js version in [.node-version](.node-version) and Microsoft Edge on Windows. With fnm configured, `fnm use --install-if-missing` selects it.

```powershell
npm ci
npm run check
npm run test:browser
npm run test:install
npm run package
```

Packaging compiles the native host with Microsoft's Roslyn toolset (5.9.0) against a pinned official WebView2 SDK (1.0.4191.47). Both are build-only, pinned by exact version and SHA512, resolved through NuGet's signed catalog and never redistributed; the first build downloads them into `dist/`. Compilation is deterministic, so an unchanged tree rebuilds to the same helper and the same archive byte for byte. The installable ZIP and its checksum are written to `dist/`. Open `wallpaper/grid-wallpaper.html` for a browser preview.

**Where to go next:** [OPERATIONS.md](OPERATIONS.md) owns validation, packaging, release, removal and recovery procedures · [AGENTS.md](AGENTS.md) owns source-editing rules · [CLAUDE.md](CLAUDE.md) is the thin agent entrypoint · [DEVLOG.md](DEVLOG.md) records completed decisions · [open issues](https://github.com/gagexhill/grid-wallpaper/issues) track current work and known limitations, including the untested [display hotplug](https://github.com/gagexhill/grid-wallpaper/issues/30).

---

## 📁 File Structure

```
grid-wallpaper/
│
├── install.ps1                 # Setup entry point: installs, updates, previews, removes links
├── wallpaper-files.json        # Distribution allowlist — what is allowed into a package
├── package.json                # Scripts and the two dev dependencies
├── .node-version               # Pinned Node.js 22.23.2
├── playwright.config.cjs       # Rendered browser test configuration
│
├── wallpaper/                  # Browser runtime, canonical config, Lively metadata, preview assets
├── windows/                    # Native settings host, lifecycle supervisor, dome telemetry
├── scripts/                    # Generation, preview, native build and packaging
├── tests/                      # Runtime, browser and installer checks
└── dist/                       # Generated release ZIP and checksum — not committed
```

The installed package is flat. The folders above exist only in a source checkout.

---

## 📚 Concepts & References

| Concept | Applied In |
|---|---|
| **Single source of truth / code generation** | `wallpaper/grid-config.js` → `scripts/lively-properties.cjs`, verified by `npm run check` |
| **Object freezing and schema clamping** | `freeze()` in `grid-config.js`; every inbound value re-clamped in `grid-wallpaper.js` |
| **Fixed-timestep simulation with an accumulator** | `frame()` in `grid-wallpaper.js` — decouples simulation rate from draw rate |
| **Canvas 2D and typed-array vertex buffers** | `draw()` in `grid-wallpaper.js`, reusing `points` and `glow` across frames |
| **Squared-distance culling** | Dome and wave bounding checks, avoiding `Math.sqrt` on rejected vertices |
| **Linear interpolation for motion smoothing** | `lerpSpeed` applied to dome position in `grid-wallpaper.js` |
| **Custom URI protocol activation** | `hostSettings.settingsUri` in `grid-config.js`, parsed by `windows/settings-window.cs` |
| **WebView2 embedding and suspension** | `windows/settings-window.cs` — hidden grace period, then suspend |
| **Loopback WebSocket with a session capability** | `windows/dome-telemetry.cs` — `HttpListener`, endpoint checks, strict frame validation |
| **Per-monitor DPI and work-area geometry** | Panel anchoring in `windows/settings-window.cs` |
| **`prefers-reduced-motion`** | `wallpaper/grid-wallpaper.css` and the settings UI |
| **Supply-chain integrity** | SHA256 per release, `wallpaper-files.json` allowlist, hash verification in `install.ps1`, SHA512-pinned build dependencies in `scripts/build-settings.ps1` |
| **Deterministic compilation** | `/deterministic` and `/pathmap` in `scripts/build-settings.ps1` — an unchanged tree rebuilds byte for byte |

---

## 👤 About the Owner

<div align="center">

**gagexhill**

[![GitHub](https://img.shields.io/badge/GitHub-gagexhill-181717?style=for-the-badge&logo=github)](https://github.com/gagexhill)

Report a problem or suggest something through [issues](https://github.com/gagexhill/grid-wallpaper/issues/new) — include your Windows and Lively versions and the error text, with personal paths removed. Report vulnerabilities through [private security reporting](https://github.com/gagexhill/grid-wallpaper/security/advisories/new).

</div>

---

<div align="center">

**Grid Wallpaper** — *the desktop, finally worth looking at.*

[MIT licensed](LICENSE.txt) · © 2026 gagexhill · The packaged WebView2 SDK libraries retain their separate redistribution notice.

</div>
