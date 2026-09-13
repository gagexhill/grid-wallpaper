(function () {
  'use strict';
  const { defaults, schema, presets, fpsOptions, mouseModes, hostSettings } = window.GridConfig;
  const settingsWindow = window.GridSettingsWindow === true;
  const clone = value => JSON.parse(JSON.stringify(value));
  const storageKey = 'grid-wallpaper.settings.v1';
  const listeners = new Set();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let storageAvailable = true, hostManaged = false, hostPaused = false;
  let config = { ...clone(defaults), snapshot: reducedMotion.matches };

  function normalize(patch, base) {
    const result = clone(base);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return result;
    for (const key of Object.keys(defaults)) {
      const value = patch[key];
      if (value === undefined) continue;
      if (key === 'domeSizes' && Array.isArray(value)) {
        result.domeSizes = defaults.domeSizes.map((_, i) => Number.isFinite(value[i])
          ? Math.max(schema.domeSize.min, Math.min(schema.domeSize.max, value[i])) : base.domeSizes[i]);
      } else if (schema[key] && Number.isFinite(value)) {
        const { min, max, step: increment } = schema[key];
        const bounded = Math.max(min, Math.min(max, value));
        result[key] = Number((min + Math.round((bounded - min) / increment) * increment).toFixed(6));
        if (key === 'count' || key === 'cellSize') result[key] = Math.round(result[key]);
      } else if (typeof defaults[key] === 'boolean' && typeof value === 'boolean') result[key] = value;
      else if ((key === 'bgColor' || key === 'lineColor') && typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) result[key] = value.toLowerCase();
      else if (key === 'fpsLimit' && fpsOptions.includes(value)) result[key] = value;
      else if (key === 'mouseMode' && mouseModes.includes(value)) result[key] = value;
    }
    return result;
  }
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      try { config = normalize(JSON.parse(saved), config); } catch { /* Invalid saved JSON uses defaults. */ }
    }
  } catch { storageAvailable = false; }

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Grid Wallpaper requires Canvas 2D support.');
  const bases = [
    [44, 1.2, 0.040], [30, 1.6, 0.060], [52, 0.7, 0.025], [22, 2, 0.080], [38, 1, 0.050],
    [48, 0.9, 0.030], [26, 1.8, 0.070], [35, 1.3, 0.045], [58, 0.5, 0.020], [18, 2.4, 0.090]
  ];
  let width = 1, height = 1;
  const domes = [], waves = [];
  let points = new Float32Array(0), glow = new Float32Array(0);
  let columns = 0, rows = 0, mouseX = Infinity, mouseY = Infinity;
  let hue = Math.random() * 360, targetHue = hue, hueHold = 0;
  let rafId = null, lastTime = null, lastRender = null, accumulator = 0, dirty = true;
  const step = 1000 / 60;

  function syncCount() {
    while (domes.length < config.count) {
      const i = domes.length;
      const x = width * (0.1 + Math.random() * 0.8), y = height * (0.1 + Math.random() * 0.8);
      domes.push({ i, x, y, tx: x, ty: y, angle: Math.random() * Math.PI * 2, av: 0,
        speed: bases[i][1] * config.speedScale, phase: Math.random() * Math.PI * 2,
        cooldown: i * 20 + Math.random() * 40, radius: 0, force: 0 });
    }
    domes.length = config.count;
  }
  function resize() {
    const oldWidth = width, oldHeight = height;
    width = Math.max(1, window.innerWidth); height = Math.max(1, window.innerHeight);
    // CSS-pixel backing avoids quadratic DPR cost on high-density laptop displays.
    canvas.width = width; canvas.height = height;
    for (const dome of domes) {
      dome.x *= width / oldWidth; dome.tx *= width / oldWidth;
      dome.y *= height / oldHeight; dome.ty *= height / oldHeight;
    }
    waves.length = 0;
    invalidate();
  }
  function prepareDomes() {
    for (const dome of domes) {
      const pulse = config.autoSize ? 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(dome.phase)) : 1;
      dome.radius = Math.min(200 * config.domeSizes[dome.i] * config.sizeScale * pulse, Math.min(width, height) * 0.38);
      dome.force = bases[dome.i][0] * config.forceScale * dome.radius / 200;
    }
  }
  // Fixed-size simulation steps preserve movement speed at every rendering FPS limit.
  function simulate() {
    prepareDomes();
    for (const dome of domes) {
      const base = bases[dome.i], speed = base[1] * config.speedScale;
      dome.av = (dome.av + (Math.random() - 0.5) * base[2]) * 0.92;
      dome.angle += dome.av;
      dome.speed = Math.max(speed * 0.4, Math.min(speed * 2.5, dome.speed + (Math.random() - 0.5) * 0.08));
      dome.tx += Math.cos(dome.angle) * dome.speed; dome.ty += Math.sin(dome.angle) * dome.speed;
      if (config.autoSize) dome.phase += 0.008 * (0.6 + dome.i * 0.08);
      if (config.mouseMode !== 'off') {
        const dx = dome.x - mouseX, dy = dome.y - mouseY, distance = Math.hypot(dx, dy);
        const reach = dome.radius * 0.85;
        if (distance > 0.1 && distance < reach) {
          const t = 1 - distance / reach, bounce = t * t * speed * 18;
          const sign = config.mouseMode === 'repel' ? 1 : -1;
          const nx = dx / distance * sign, ny = dy / distance * sign;
          dome.x += nx * bounce * 0.4; dome.y += ny * bounce * 0.4;
          dome.tx += nx * bounce; dome.ty += ny * bounce;
          const angle = Math.atan2(ny, nx) - dome.angle;
          dome.angle += Math.atan2(Math.sin(angle), Math.cos(angle)) * t * 0.5;
        }
      }
      const marginX = Math.min(60, width * 0.1), marginY = Math.min(60, height * 0.1);
      if (dome.tx < marginX || dome.tx > width - marginX) {
        dome.angle = Math.atan2(Math.sin(dome.angle), -Math.cos(dome.angle)) + (Math.random() - 0.5) * 0.3;
        dome.tx = Math.max(marginX, Math.min(width - marginX, dome.tx));
      }
      if (dome.ty < marginY || dome.ty > height - marginY) {
        dome.angle = Math.atan2(-Math.sin(dome.angle), Math.cos(dome.angle)) + (Math.random() - 0.5) * 0.3;
        dome.ty = Math.max(marginY, Math.min(height - marginY, dome.ty));
      }
      dome.x += (dome.tx - dome.x) * config.lerpSpeed; dome.y += (dome.ty - dome.y) * config.lerpSpeed;
      if (config.gradientLines && --dome.cooldown <= 0) {
        if (waves.length < 15) waves.push({ x: dome.x, y: dome.y, start: dome.radius * 0.3, max: dome.radius * 3, age: 0, r: 0, opacity: 0 });
        dome.cooldown = 140 + Math.random() * 80;
      }
    }
    for (let i = waves.length - 1; i >= 0; i--) {
      const wave = waves[i];
      if (++wave.age >= 360) waves.splice(i, 1);
      else {
        const t = wave.age / 360;
        wave.r = wave.start + (wave.max - wave.start) * (1 - (1 - t) ** 2);
        wave.opacity = 0.45 * (1 - t) ** 1.4;
      }
    }
    if (config.autoColor) {
      if (--hueHold <= 0) { targetHue = (hue + 90 + Math.random() * 180) % 360; hueHold = 900 + Math.random() * 1800; }
      const diff = ((targetHue - hue + 540) % 360) - 180;
      hue = (hue + diff * 0.04 + 360) % 360;
    }
  }
  function lineColor() {
    if (!config.autoColor) return config.lineColor;
    return 'hsl(' + hue + ' ' + (60 + 20 * Math.sin(hue * Math.PI / 90)) + '% ' + (68 + 15 * Math.cos(hue * Math.PI / 120)) + '%)';
  }
  function draw() {
    prepareDomes();
    const cell = config.cellSize;
    columns = Math.ceil(width / cell) + 4; rows = Math.ceil(height / cell) + 4;
    const count = columns * rows;
    if (points.length !== count * 2) { points = new Float32Array(count * 2); glow = new Float32Array(count); }
    // Rows, columns and ripples share one calculation per vertex and reuse typed buffers.
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const gx = column * cell, gy = row * cell, index = row * columns + column;
        let ox = 0, oy = 0, edge = 1, intensity = 0;
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
        points[index * 2] = gx + ox; points[index * 2 + 1] = gy + oy;
        for (const wave of waves) {
          const dx = gx - wave.x, dy = gy - wave.y, squared = dx * dx + dy * dy;
          if (squared > (wave.r + 40) ** 2 || squared < Math.max(0, wave.r - 40) ** 2) continue;
          const fade = 1 - Math.abs(Math.sqrt(squared) - wave.r) / 40;
          if (fade > 0) intensity += wave.opacity * fade * fade;
        }
        glow[index] = Math.min(0.8, intensity * edge);
      }
    }
    ctx.globalAlpha = 1; ctx.fillStyle = config.bgColor; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = lineColor(); ctx.lineWidth = 1; ctx.globalAlpha = config.lineOpacity;
    ctx.beginPath();
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const i = (row * columns + column) * 2;
        if (column === 0) ctx.moveTo(points[i], points[i + 1]); else ctx.lineTo(points[i], points[i + 1]);
      }
    }
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < rows; row++) {
        const i = (row * columns + column) * 2;
        if (row === 0) ctx.moveTo(points[i], points[i + 1]); else ctx.lineTo(points[i], points[i + 1]);
      }
    }
    ctx.stroke();
    if (waves.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < count; i++) {
        if (i % columns !== columns - 1) strokeGlow(i, i + 1);
        if (i < count - columns) strokeGlow(i, i + columns);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1; dirty = false;
  }
  function strokeGlow(a, b) {
    const opacity = (glow[a] + glow[b]) / 2;
    if (opacity <= 0.01) return;
    ctx.globalAlpha = opacity; ctx.beginPath();
    ctx.moveTo(points[a * 2], points[a * 2 + 1]); ctx.lineTo(points[b * 2], points[b * 2 + 1]); ctx.stroke();
  }
  function schedule() {
    if (!settingsWindow && rafId === null && !document.hidden && !hostPaused && (dirty || !config.snapshot)) rafId = requestAnimationFrame(frame);
  }
  function stop() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null; lastTime = null; lastRender = null; accumulator = 0;
  }
  function invalidate() { dirty = true; schedule(); }
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
  function notify() { for (const listener of listeners) listener(clone(config)); }
  function update(patch, persist = true) {
    const wasFrozen = config.snapshot;
    config = normalize(patch, config);
    if (wasFrozen !== config.snapshot) stop();
    if (!config.gradientLines) waves.length = 0;
    syncCount();
    document.getElementById('vignette')?.classList.toggle('on', config.vignette);
    if (persist && !hostManaged) {
      try { window.localStorage.setItem(storageKey, JSON.stringify(config)); storageAvailable = true; }
      catch { storageAvailable = false; }
    }
    invalidate(); notify(); return clone(config);
  }
  function reset() { return update({ ...clone(defaults), snapshot: reducedMotion.matches }); }
  function randomize() {
    const random = (a, b) => Number((a + (b - a) * Math.random()).toFixed(2));
    return update({ sizeScale: random(0.4, 2), speedScale: random(0.3, 2.5), forceScale: random(0.4, 2), lerpSpeed: random(0.02, 0.2), cellSize: Math.round(random(12, 40)) });
  }
  window.GridWallpaper = Object.freeze({ defaults, schema, presets, fpsOptions, mouseModes, hostSettings,
    getConfig: () => clone(config), update, reset, randomize,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    get storageAvailable() { return storageAvailable; }, get hostManaged() { return hostManaged; }
  });
  window.livelyPropertyListener = function (name, value) {
    if (!hostManaged) { hostManaged = true; config = clone(defaults); }
    const patch = {};
    if (name === 'fpsLimit') patch.fpsLimit = fpsOptions[value];
    else if (name === 'mouseMode') patch.mouseMode = mouseModes[value];
    else if (/^domeSize[0-9]$/.test(name)) {
      patch.domeSizes = config.domeSizes.slice(); patch.domeSizes[Number(name.slice(-1))] = value;
    } else if (Object.hasOwn(defaults, name)) patch[name] = value;
    update(patch, false);
  };
  window.livelyWallpaperPlaybackChanged = function (data) {
    try {
      const message = typeof data === 'string' ? JSON.parse(data) : data;
      if (typeof message?.IsPaused !== 'boolean') return;
      hostPaused = message.IsPaused; stop(); if (!hostPaused) invalidate();
    } catch { /* Malformed host messages leave playback unchanged. */ }
  };
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { stop(); if (!document.hidden) invalidate(); });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', invalidate);
  window.addEventListener('pointermove', event => {
    if (event.target.closest?.('#panel, #hamburger')) { mouseX = mouseY = Infinity; return; }
    mouseX = event.clientX; mouseY = event.clientY;
  }, { passive: true });
  const clearPointer = () => { mouseX = mouseY = Infinity; };
  document.documentElement.addEventListener('pointerleave', clearPointer);
  window.addEventListener('blur', clearPointer);
  window.addEventListener('pointercancel', clearPointer);
  reducedMotion.addEventListener('change', event => { if (event.matches && !hostManaged) update({ snapshot: true }); });
  resize(); syncCount(); update({}, false);
})();
