# Grid Wallpaper

## Project Overview

Interactive animated grid wallpaper rendered on HTML5 Canvas. Designed as a live desktop wallpaper (via Lively Wallpaper on Windows / WebSaver on macOS) or a browser-based screensaver.

**Owner**: Ventryn LLC
**Status**: Functional

## Architecture

Two files, no build step:
- **`grid-wallpaper.html`** (~608 lines): CSS + HTML markup — dark theme UI, skeleton loading states, custom color picker, collapsible panel sections, toggle switches, slider styling, vignette overlay, canvas element, settings panel with draggable hamburger menu
- **`grid-wallpaper.js`** (~1454 lines): All JavaScript logic — canvas rendering, dome wanderers, panel controls, presets, color picker, tooltips. Loaded via `<script src="grid-wallpaper.js">`

## Core Systems

### Rendering (Canvas 2D)
- Grid lines drawn per-frame with displacement from "dome" wanderers
- Each dome distorts nearby grid intersections via sine-based force fields
- "Dent" system: click-on-dome creates spring-physics ripple (jello bounce)
- Grid ripple: additive glow waves emanate from domes when enabled
- Vignette: CSS radial gradient overlay

### Dome Wanderers
- Up to 10 domes defined in `BASE[]` array with per-dome radius, force, speed, angle drift
- Wanderers bounce off viewport edges, react to mouse (repel/attract mode)
- Individual dome sizes stored in `C.domeSizes[]`, auto-size mode pulses via sine phases

### Settings Panel
- Collapsible sections: Global, Individual Dome Sizes, Performance, Presets, Appearance
- Skeleton shimmer loading animation on first open
- Cascading reveal/collapse animations (row-by-row with clip-path)
- Slider thumb tween-in animation on section expand
- Custom color picker (HSV saturation-lightness pad + hue bar + hex/RGB inputs)
- Tooltip system via `data-tip` attributes on `i` info buttons

### Configuration Object
All state lives in `var C` (mutable copy of frozen `DEFAULTS`):
- `count`, `sizeScale`, `speedScale`, `forceScale`, `lerpSpeed`
- `cellSize`, `bgColor`, `lineColor`, `lineOpacity`
- `autoColor`, `mouseMode`, `autoSize`, `vignette`, `snapshot`, `fpsLimit`, `gradientLines`
- `domeSizes[0..9]`

### Presets
8 built-in: Dusk, Slate, Sage, Ash, Plum, Sand, Frost, Ember
Each sets colors, opacity, cell size, dome count, scales, and vignette.

### Performance Controls
- FPS limiter: 15 / 24 / 30 / 60 via stepper
- Freeze Frame (snapshot): stops animation loop, holds last rendered frame
- Dent clicks still animate during freeze via `_forceFrames`
- Tab visibility API pauses/resumes animation

## Key Globals

| Variable | Purpose |
|----------|---------|
| `C` | Live config object (mutated by UI) |
| `DEFAULTS` | Frozen reset values |
| `BASE[]` | 10 dome templates (radius, force, speed, angle drift) |
| `PRESETS[]` | 8 color/motion themes |
| `ws[]` | Active wanderer instances |
| `_waves[]` | Active grid ripple wavefronts |
| `_dents[]` | Active spring-physics dent depressions |
| `_domeSzMult[]` | Auto-size multipliers per dome |
| `_autoHue` | Current auto-color hue angle |

## Dependencies

- Google Fonts: Inter (400/500/600/700) via CDN
- No JS libraries, no build tools, no npm

## How to Run

Open `grid-wallpaper.html` in any modern browser. For desktop wallpaper use:
- **Windows**: Lively Wallpaper (free, Microsoft Store)
- **macOS**: WebSaver (free, Mac App Store)
- **Static**: F11 fullscreen + screenshot

## Development Notes

- All code uses `var` (ES5-style), no arrow functions — intentional for broad compatibility
- Color conversion: separate HSL (auto-color cycle) and HSV (color picker) utilities
- Panel position tracks hamburger: `.panel-left` class flips when hamburger snaps to left edge
- `setSliderPct()` updates CSS `--pct` custom property for filled-track styling
- `createToggle()` is a factory for pointer-draggable + keyboard-accessible toggle switches
