'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sources = ['grid-config.js', 'grid-wallpaper.js'].map(name => ({
  name,
  source: fs.readFileSync(path.join(root, name), 'utf8')
}));

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    dispatch(name, event = {}) {
      for (const listener of listeners.get(name) || []) listener(event);
    }
  };
}

function createRuntime(options = {}) {
  let now = 0;
  let nextId = 1;
  let seed = 123456789;
  let paintCount = 0;
  let clearCount = 0;
  let lastGeometry = [];
  let lastBackground;
  const rafs = new Map();
  const timers = new Map();
  const storage = new Map(options.storage || []);
  const writes = [];
  const math = Object.create(Math);
  math.random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const context = {
    fillRect() {
      paintCount++;
      lastBackground = this.fillStyle;
      lastGeometry = [];
    },
    clearRect() { clearCount++; },
    moveTo(x, y) { lastGeometry.push(x, y); },
    lineTo(x, y) { lastGeometry.push(x, y); },
    beginPath() {}, stroke() {}, save() {}, restore() {},
    setTransform() {}, scale() {},
    createLinearGradient() { return { addColorStop() {} }; }
  };
  const canvas = {
    ...eventTarget(),
    style: {},
    getContext: () => context,
    set width(value) { this._width = value; clearCount++; },
    get width() { return this._width; },
    set height(value) { this._height = value; clearCount++; },
    get height() { return this._height; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 180 })
  };
  const vignette = { classList: { toggle() {} }, style: {} };
  const reducedMotion = Object.assign(eventTarget(), { matches: !!options.reducedMotion });
  const document = Object.assign(eventTarget(), {
    hidden: false,
    visibilityState: 'visible',
    getElementById: id => id === 'c' ? canvas : id === 'vignette' ? vignette : null,
    documentElement: Object.assign(eventTarget(), { style: {} }),
    body: { style: {} }
  });
  const sandbox = Object.assign(eventTarget(), {
    document,
    Math: math,
    console,
    innerWidth: 320,
    innerHeight: 180,
    devicePixelRatio: 1,
    performance: { now: () => now },
    matchMedia: () => reducedMotion,
    requestAnimationFrame(callback) {
      const id = nextId++;
      rafs.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { rafs.delete(id); },
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    localStorage: {
      getItem(key) {
        if (options.storageUnavailable) throw new Error('Storage is unavailable');
        return storage.has(key) ? storage.get(key) : (options.initialStorage ?? null);
      },
      setItem(key, value) {
        if (options.storageUnavailable) throw new Error('Storage is unavailable');
        storage.set(key, String(value));
        writes.push([key, String(value)]);
      },
      removeItem(key) {
        if (options.storageUnavailable) throw new Error('Storage is unavailable');
        storage.delete(key);
      }
    }
  });
  sandbox.window = sandbox;
  const environment = vm.createContext(sandbox);
  for (const { name, source } of sources) {
    vm.runInContext(source, environment, { filename: name });
  }

  function flushTimers() {
    for (let pass = 0; pass < 20 && timers.size; pass++) {
      const ready = [...timers.entries()];
      timers.clear();
      now = Math.max(now, ...ready.map(([, timer]) => timer.due));
      for (const [, timer] of ready) timer.callback();
    }
    assert.equal(timers.size, 0, 'Persistence should not install a recurring timer');
  }

  function step(elapsed = 1000 / 60) {
    now += elapsed;
    const pending = [...rafs.entries()];
    for (const [id] of pending) rafs.delete(id);
    for (const [, callback] of pending) callback(now);
  }

  return {
    window: sandbox,
    document,
    api: sandbox.GridWallpaper,
    storage,
    writes,
    step,
    flushTimers,
    advance(elapsed) { now += elapsed; },
    paint() { for (let i = 0; i < 6; i++) step(); },
    visibility(hidden) {
      document.hidden = hidden;
      document.visibilityState = hidden ? 'hidden' : 'visible';
      document.dispatch('visibilitychange');
    },
    playback(paused) {
      sandbox.livelyWallpaperPlaybackChanged(JSON.stringify({ IsPaused: paused }));
    },
    get queued() { return rafs.size; },
    get paints() { return paintCount; },
    get clears() { return clearCount; },
    get geometry() { return [...lastGeometry]; },
    get background() { return lastBackground; }
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertValidConfig(runtime) {
  const config = runtime.api.getConfig();
  for (const [key, rule] of Object.entries(runtime.api.schema)) {
    const values = key === 'domeSize' ? config.domeSizes : [config[key]];
    for (const value of values) {
      assert.ok(Number.isFinite(value), `${key} must stay finite`);
      assert.ok(value >= rule.min && value <= rule.max, `${key} must stay in bounds`);
    }
  }
  assert.ok(Number.isInteger(config.count));
  assert.equal(config.domeSizes.length, 10);
  assert.match(config.bgColor, /^#[0-9a-f]{6}$/i);
  assert.match(config.lineColor, /^#[0-9a-f]{6}$/i);
  assert.ok([15, 24, 30, 60].includes(config.fpsLimit));
  assert.ok(['repel', 'attract', 'off'].includes(config.mouseMode));
}

test('repeated resume requests retain one animation scheduler', () => {
  const runtime = createRuntime();
  runtime.paint();
  runtime.api.update({ snapshot: true });
  runtime.paint();
  assert.equal(runtime.queued, 0);

  runtime.api.update({ snapshot: false });
  runtime.api.update({ snapshot: false });
  runtime.visibility(false);
  runtime.visibility(false);
  assert.equal(runtime.queued, 1);
  for (let i = 0; i < 12; i++) {
    runtime.step();
    assert.equal(runtime.queued, 1);
  }
});

test('resizing a frozen wallpaper repaints once and stays frozen', () => {
  const runtime = createRuntime();
  runtime.api.update({ snapshot: true });
  runtime.paint();
  const paints = runtime.paints;
  const clears = runtime.clears;
  runtime.window.innerWidth = 400;
  runtime.window.dispatch('resize');
  runtime.paint();
  assert.ok(runtime.clears > clears, 'Resize must update the canvas backing dimensions');
  assert.equal(runtime.paints, paints + 1);
  assert.equal(runtime.queued, 0);
  assert.equal(runtime.api.getConfig().snapshot, true);
});

test('appearance edits repaint while frozen without starting animation', () => {
  const runtime = createRuntime();
  runtime.api.update({ snapshot: true });
  runtime.paint();
  const paints = runtime.paints;
  runtime.api.update({ bgColor: '#123456', cellSize: 25 });
  runtime.paint();
  assert.equal(runtime.paints, paints + 1);
  assert.equal(runtime.background, '#123456');
  assert.ok(runtime.geometry.length > 0);
  assert.equal(runtime.queued, 0);
});

test('Lively playback and document visibility both suspend scheduled rendering', () => {
  const runtime = createRuntime();
  runtime.paint();
  runtime.playback(true);
  assert.equal(runtime.queued, 0);
  const paints = runtime.paints;
  runtime.advance(60_000);
  runtime.paint();
  assert.equal(runtime.paints, paints);

  runtime.visibility(true);
  runtime.playback(false);
  assert.equal(runtime.queued, 0, 'A hidden page must remain paused after a host resume');
  runtime.visibility(false);
  runtime.playback(false);
  assert.equal(runtime.queued, 1);
  runtime.paint();
  assert.ok(runtime.paints > paints);
  assert.doesNotThrow(() => runtime.window.livelyWallpaperPlaybackChanged('{invalid'));
});

test('time spent paused does not cause a catch-up jump', () => {
  const immediate = createRuntime();
  const delayed = createRuntime();
  for (const runtime of [immediate, delayed]) {
    runtime.api.update({ fpsLimit: 60, autoSize: true, autoColor: true });
    for (let i = 0; i < 6; i++) runtime.step(20);
    runtime.playback(true);
  }
  delayed.advance(60 * 60 * 1000);
  for (const runtime of [immediate, delayed]) {
    runtime.playback(false);
    for (let i = 0; i < 6; i++) runtime.step(20);
  }
  assert.deepEqual(delayed.geometry, immediate.geometry);
  assert.deepEqual(plain(delayed.api.getConfig()), plain(immediate.api.getConfig()));
});

test('15 and 60 FPS produce identical simulation geometry after equal elapsed time', () => {
  const eco = createRuntime();
  const full = createRuntime();
  for (const [runtime, fpsLimit] of [[eco, 15], [full, 60]]) {
    runtime.api.update({ fpsLimit, autoSize: true, autoColor: true, gradientLines: true });
    runtime.step(0);
    for (let i = 0; i < 120; i++) runtime.step(10);
  }
  assert.ok(eco.paints < full.paints / 2, 'The FPS setting must reduce actual rendering work');
  // Repaint both at the same timestamp so comparison is independent of their last display frame.
  for (const runtime of [eco, full]) {
    runtime.api.update({});
    runtime.step(0);
  }
  assert.ok(eco.geometry.length > 0);
  assert.deepEqual(eco.geometry, full.geometry);
});

test('malformed or unavailable browser storage never prevents startup', () => {
  for (const initialStorage of ['{invalid', 'null', '[]', '42', '"text"']) {
    const runtime = createRuntime({ initialStorage });
    assertValidConfig(runtime);
    runtime.paint();
    assert.ok(runtime.paints > 0);
  }
  const runtime = createRuntime({ storageUnavailable: true });
  assert.equal(runtime.api.storageAvailable, false);
  assert.doesNotThrow(() => runtime.api.update({ bgColor: '#123456' }));
  assert.doesNotThrow(() => runtime.flushTimers());
  runtime.paint();
  assert.ok(runtime.paints > 0);
});

test('untrusted settings stay finite, bounded, and restricted to supported values', () => {
  const runtime = createRuntime();
  for (const invalid of [NaN, Infinity, -Infinity, -1e20, 1e20, null, {}, 'invalid']) {
    const patch = {};
    for (const key of Object.keys(runtime.api.schema)) {
      if (key !== 'domeSize') patch[key] = invalid;
    }
    patch.domeSizes = Array(10).fill(invalid);
    patch.bgColor = 'url(https://invalid.example)';
    patch.lineColor = '#broken';
    patch.fpsLimit = invalid;
    patch.mouseMode = invalid;
    patch.unsupported = true;
    runtime.api.update(patch);
    assertValidConfig(runtime);
    assert.equal(Object.hasOwn(runtime.api.getConfig(), 'unsupported'), false);
  }
  for (const domeSizes of [null, [], [1], {}, 'invalid']) {
    runtime.api.update({ domeSizes });
    assertValidConfig(runtime);
  }
});

test('browser settings round-trip and reset to canonical defaults', () => {
  const first = createRuntime();
  first.api.update({ bgColor: '#123456', speedScale: 2.3, snapshot: true });
  first.flushTimers();
  assert.ok(first.writes.length > 0);
  const restored = createRuntime({ storage: first.storage });
  assert.equal(restored.api.getConfig().bgColor, '#123456');
  assert.equal(restored.api.getConfig().speedScale, 2.3);
  restored.api.reset();
  restored.flushTimers();
  assert.deepEqual(plain(restored.api.getConfig()), plain(restored.api.defaults));
  const reset = createRuntime({ storage: restored.storage });
  assert.deepEqual(plain(reset.api.getConfig()), plain(reset.api.defaults));
});

test('invalid fields in a saved settings record cannot corrupt rendering', () => {
  const first = createRuntime();
  first.api.update({ speedScale: 1.7 });
  first.flushTimers();
  let changed = 0;
  function corrupt(value) {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (key === 'count' || key === 'cellSize') {
        value[key] = -1e100;
        changed++;
      } else if (key === 'domeSizes') {
        value[key] = [null, 'invalid', -100];
        changed++;
      } else if (key === 'bgColor') {
        value[key] = 'invalid';
        changed++;
      } else corrupt(value[key]);
    }
  }
  const storage = new Map(first.storage);
  for (const [key, text] of storage) {
    const saved = JSON.parse(text);
    corrupt(saved);
    storage.set(key, JSON.stringify(saved));
  }
  assert.ok(changed > 0, 'The fixture must alter fields actually saved by the runtime');
  const restored = createRuntime({ storage });
  assertValidConfig(restored);
  restored.paint();
  assert.ok(restored.paints > 0);
  assert.ok(restored.geometry.every(Number.isFinite));
});

test('native Lively properties override browser settings without rewriting them', () => {
  const browser = createRuntime();
  browser.api.update({ bgColor: '#123456', speedScale: 2.3 });
  browser.flushTimers();
  const host = createRuntime({ storage: browser.storage });
  host.window.livelyPropertyListener('speedScale', 1.7);
  assert.equal(host.api.hostManaged, true);
  assert.equal(host.api.getConfig().speedScale, 1.7);
  assert.equal(host.api.getConfig().bgColor, host.api.defaults.bgColor);
  host.window.livelyPropertyListener('bgColor', '#abcdef');
  assert.equal(host.api.getConfig().bgColor, '#abcdef');
  host.flushTimers();
  const browserAgain = createRuntime({ storage: host.storage });
  assert.equal(browserAgain.api.getConfig().bgColor, '#123456');
  assert.equal(browserAgain.api.getConfig().speedScale, 2.3);
});

test('native dropdown indices and individual dome properties use supported values', () => {
  const runtime = createRuntime();
  const property = (name, value) => runtime.window.livelyPropertyListener(name, value);
  property('fpsLimit', 0);
  assert.equal(runtime.api.getConfig().fpsLimit, 15);
  property('fpsLimit', 3);
  assert.equal(runtime.api.getConfig().fpsLimit, 60);
  property('mouseMode', 2);
  assert.equal(runtime.api.getConfig().mouseMode, 'off');
  property('domeSize9', 0.77);
  assert.equal(runtime.api.getConfig().domeSizes[9], 0.77);
  property('snapshot', true);
  assert.equal(runtime.api.getConfig().snapshot, true);
  property('fpsLimit', 1000);
  property('mouseMode', -1);
  property('domeSize0', Infinity);
  assertValidConfig(runtime);
  runtime.paint();
  assert.equal(runtime.queued, 0);
});
