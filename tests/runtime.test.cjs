'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../wallpaper');
const sources = ['grid-config.js', 'grid-wallpaper.js'].map(name => ({
  name,
  source: fs.readFileSync(path.join(root, name), 'utf8')
}));
const telemetrySource = fs.readFileSync(path.join(root, 'grid-live-telemetry.js'), 'utf8');

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
  const scripts = [];
  const sockets = [];
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
    moveTo(x, y) { lastGeometry.push(x, y); },
    lineTo(x, y) { lastGeometry.push(x, y); },
    beginPath() {}, stroke() {}
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
    body: { style: {} },
    baseURI: 'file:///wallpapers/grid%20wallpaper/grid-wallpaper.html',
    head: { appendChild(script) { scripts.push(script); } },
    createElement: () => ({ remove() { this.removed = true; } })
  });
  const sandbox = Object.assign(eventTarget(), {
    document,
    Math: math,
    console,
    innerWidth: 320,
    innerHeight: 180,
    devicePixelRatio: 1,
    screen: { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1040 },
    GridSettingsWindow: !!options.settingsWindow,
    chrome: options.webView2 ? { webview: {} } : undefined,
    URL,
    WebSocket: class {
      static OPEN = 1;
      constructor(url, protocols) {
        this.url = url; this.protocols = protocols; this.sent = [];
        this.readyState = 0; this.bufferedAmount = 0; sockets.push(this);
      }
      send(message) { this.sent.push(JSON.parse(message)); }
      close() { this.readyState = 3; this.closed = true; }
      open() { this.readyState = 1; this.onopen?.(); }
      message(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
      disconnect() { this.readyState = 3; this.onclose?.(); }
    },
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
    scripts,
    sockets,
    loadTelemetry() { vm.runInContext(telemetrySource, environment, { filename: 'grid-live-telemetry.js' }); },
    runTimers(elapsed) {
      now += elapsed;
      for (let pass = 0; pass < 100; pass++) {
        const ready = [...timers.entries()].filter(([, timer]) => timer.due <= now);
        if (!ready.length) return;
        for (const [id, timer] of ready) {
          if (timers.delete(id)) timer.callback();
        }
      }
      assert.fail('Timers did not settle within the bounded test window');
    },
    get pendingTimers() { return timers.size; },
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

test('live dome state follows rendered pulses without changing configuration or scheduling another frame loop', () => {
  const runtime = createRuntime();
  runtime.api.update({ autoSize: true, fpsLimit: 60 });
  const config = plain(runtime.api.getConfig());
  const writes = runtime.writes.length;
  const states = [];
  const unsubscribe = runtime.api.subscribeDomeState(state => states.push(plain(state)));
  assert.equal(states[0], null, 'No size is invented before the first render');
  runtime.step(0);
  const first = runtime.api.getDomeState();
  for (let frame = 0; frame < 20; frame++) {
    runtime.step(20);
    assert.equal(runtime.queued, 1);
  }
  const last = runtime.api.getDomeState();
  assert.ok(last.sequence > first.sequence);
  assert.notDeepEqual(plain(last.sizes), plain(first.sizes));
  assert.equal(states.filter(Boolean).length, runtime.paints);
  for (const state of states.filter(Boolean)) {
    assert.equal(state.autoSize, true);
    assert.equal(state.paused, false);
    assert.deepEqual(state.bases, config.domeSizes.slice(0, config.count));
    state.sizes.forEach((size, index) => {
      assert.ok(size >= state.bases[index] * runtime.window.GridConfig.domePulse.min);
      assert.ok(size <= state.bases[index] * runtime.window.GridConfig.domePulse.max);
    });
  }
  last.sizes[0] = 999;
  assert.notEqual(runtime.api.getDomeState().sizes[0], 999);
  assert.deepEqual(plain(runtime.api.getConfig()), config);
  assert.equal(runtime.writes.length, writes);
  unsubscribe();
  const notifications = states.length;
  runtime.paint();
  assert.equal(states.length, notifications);
  assert.equal(runtime.queued, 1);
});

test('frozen and paused telemetry retains the last real size and never animates independently', () => {
  const runtime = createRuntime();
  runtime.api.update({ autoSize: true });
  runtime.paint();
  const rendered = plain(runtime.api.getDomeState().sizes);
  runtime.playback(true);
  assert.equal(runtime.api.getDomeState().paused, true);
  runtime.advance(60_000);
  runtime.paint();
  assert.deepEqual(plain(runtime.api.getDomeState().sizes), rendered);
  assert.equal(runtime.queued, 0);
  runtime.playback(false);
  runtime.api.update({ snapshot: true });
  runtime.paint();
  const frozen = plain(runtime.api.getDomeState().sizes);
  assert.equal(runtime.api.getDomeState().paused, true);
  runtime.paint();
  assert.deepEqual(plain(runtime.api.getDomeState().sizes), frozen);
  assert.equal(runtime.queued, 0);
  runtime.api.update({ snapshot: false });
  runtime.paint();
  runtime.visibility(true);
  assert.equal(runtime.api.getDomeState().paused, true);
  assert.equal(runtime.queued, 0);
  runtime.visibility(false);
  runtime.paint();
  assert.equal(runtime.api.getDomeState().paused, false);
  runtime.api.update({ autoSize: false });
  assert.equal(runtime.api.getDomeState(), null, 'Configuration changes invalidate the preceding frame');
  runtime.paint();
  assert.deepEqual(plain(runtime.api.getDomeState().sizes), plain(runtime.api.getDomeState().bases));
});

test('native dome readouts accept only matching, bounded fresh telemetry and never start a simulated wallpaper', () => {
  const source = createRuntime();
  const panel = createRuntime({ settingsWindow: true, webView2: true });
  for (const runtime of [source, panel]) runtime.api.update({ autoSize: true }, false);
  source.paint();
  const frame = plain(source.api.getDomeState());
  const config = plain(panel.api.getConfig());
  assert.equal(panel.api.getDomeState(), null);
  assert.equal(panel.api.setDomeState(frame), true);
  assert.deepEqual(plain(panel.api.getDomeState()), frame);
  assert.equal(panel.api.setDomeState(frame), false, 'Duplicate sequences cannot replay an old size');
  for (const changes of [
    { sizes: [99, ...frame.sizes.slice(1)] }, { bases: [0, ...frame.bases.slice(1)] },
    { sizes: [null, ...frame.sizes.slice(1)] }, { autoSize: false }, { paused: 'false' },
    { screen: { ...frame.screen, scale: Infinity } }, { screen: { ...frame.screen, width: -1 } },
    { sequence: Number.MAX_SAFE_INTEGER + 1 }
  ]) assert.equal(panel.api.setDomeState({ ...frame, sequence: frame.sequence + 1, ...changes }), false);
  assert.equal(source.api.setDomeState(frame), false, 'Telemetry cannot alter an actual renderer');
  panel.paint();
  assert.equal(panel.paints, 0);
  assert.equal(panel.queued, 0);
  assert.equal(panel.writes.length, 0);
  assert.deepEqual(plain(panel.api.getConfig()), config);
  panel.api.update({ domeSizes: [1.4, ...config.domeSizes.slice(1)] }, false);
  assert.equal(panel.api.getDomeState(), null);
  assert.equal(panel.api.setDomeState({ ...frame, sequence: frame.sequence + 2 }), false);
  panel.api.update(config, false);
  assert.equal(panel.api.setDomeState(null), true);
  assert.equal(panel.api.getDomeState(), null);
  assert.equal(panel.api.setDomeState({ ...frame, sequence: 0 }), true, 'A new connection starts a new sequence after explicit loss');
});

function connectPublisher(runtime, token = 'a'.repeat(43)) {
  const script = runtime.scripts.at(-1);
  assert.ok(script && !script.removed);
  assert.equal(runtime.window.GridLiveTelemetry.connect({ url: 'ws://127.0.0.1:54321/grid-wallpaper/', token }), true);
  script.onload();
  const socket = runtime.sockets.at(-1);
  socket.open();
  return socket;
}

test('desktop publisher waits for a native host and confines authenticated connections to the local bridge', () => {
  for (const options of [{}, { settingsWindow: true, webView2: true }]) {
    const runtime = createRuntime(options);
    runtime.loadTelemetry();
    runtime.window.livelyPropertyListener('autoSize', true);
    assert.equal(runtime.scripts.length, 0);
    assert.equal(runtime.sockets.length, 0);
  }
  const runtime = createRuntime({ webView2: true });
  runtime.loadTelemetry();
  assert.equal(runtime.scripts.length, 0);
  runtime.window.livelyPropertyListener('autoSize', true);
  assert.equal(runtime.scripts.length, 1);
  const bootstrapUrl = new URL(runtime.scripts[0].src);
  assert.equal(bootstrapUrl.pathname, '/wallpapers/grid%20wallpaper/windows-telemetry.js');
  assert.ok(bootstrapUrl.searchParams.has('v'));
  for (const url of ['ws://evil.example:54321/grid-wallpaper/', 'ws://127.0.0.1:65536/grid-wallpaper/',
    'ws://127.0.0.1:54321/other/', 'ws://127.0.0.1:54321/grid-wallpaper/?token=bad',
    'wss://127.0.0.1:54321/grid-wallpaper/']) {
    assert.equal(runtime.window.GridLiveTelemetry.connect({ url, token: 'a'.repeat(43) }), false);
  }
  assert.equal(runtime.window.GridLiveTelemetry.connect({ url: 'ws://127.0.0.1:54321/grid-wallpaper/', token: 'short' }), false);
  const socket = connectPublisher(runtime);
  assert.deepEqual(plain(socket.protocols), ['grid-wallpaper-v1', 'grid-wallpaper-token.' + 'a'.repeat(43)]);
  assert.equal(socket.sent[0].kind, 'hello');
  assert.deepEqual(socket.sent[0].screen, { left: 0, top: 0, width: 1920, height: 1040, scale: 1 });
  assert.equal(runtime.scripts[0].removed, true);
  assert.equal(runtime.pendingTimers, 0);
  runtime.paint();
  assert.equal(socket.sent.length, 1, 'A closed settings panel does not subscribe to renderer frames');
});

test('desktop publisher sends bounded fresh frames only on demand and cancels pending work on disconnect', () => {
  const runtime = createRuntime({ webView2: true });
  runtime.loadTelemetry();
  runtime.window.livelyPropertyListener('autoSize', true);
  const socket = connectPublisher(runtime);
  runtime.paint();
  const config = plain(runtime.api.getConfig());
  socket.message({ kind: 'update', autoSize: false });
  socket.message({ kind: 'stream', active: true, command: 'extra' });
  assert.equal(socket.sent.length, 1);
  assert.deepEqual(plain(runtime.api.getConfig()), config);
  socket.message({ kind: 'stream', active: true });
  assert.equal(socket.sent.length, 2);
  for (let i = 0; i < 30; i++) runtime.step(1000 / 60);
  const frames = socket.sent.filter(message => message.kind === 'domes');
  assert.ok(frames.length <= 9, 'The bridge caps continuous telemetry near 15 FPS');
  assert.ok(frames.length >= 5);
  assert.ok(frames.every((state, index) => !index || state.sequence > frames[index - 1].sequence));
  runtime.api.update({ snapshot: true }, false);
  runtime.paint();
  runtime.runTimers(100);
  assert.equal(socket.sent.at(-1).paused, true, 'The final frozen frame cannot be lost to throttling');
  assert.deepEqual(socket.sent.at(-1).sizes, plain(runtime.api.getDomeState().sizes));
  assert.equal(runtime.queued, 0);
  const sent = socket.sent.length;
  socket.message({ kind: 'stream', active: false });
  runtime.api.update({ snapshot: false }, false);
  runtime.paint();
  runtime.runTimers(100);
  assert.equal(socket.sent.length, sent);
  assert.equal(runtime.pendingTimers, 0);
  socket.message({ kind: 'stream', active: true });
  socket.bufferedAmount = 1000;
  const backpressured = socket.sent.length;
  runtime.paint();
  runtime.runTimers(100);
  assert.equal(socket.sent.length, backpressured, 'A slow receiver never queues obsolete size frames');
  runtime.api.update({ snapshot: true }, false);
  runtime.paint();
  assert.equal(runtime.pendingTimers, 1, 'Backpressure keeps only one latest-state retry');
  socket.bufferedAmount = 0;
  runtime.runTimers(100);
  assert.equal(socket.sent.at(-1).paused, true, 'The last frozen state is delivered after backpressure drains');
  assert.deepEqual(socket.sent.at(-1).sizes, plain(runtime.api.getDomeState().sizes));
  socket.disconnect();
  assert.equal(runtime.pendingTimers, 1);
  runtime.window.livelyPropertyListener('lineOpacity', 0.1);
  assert.equal(runtime.scripts.length, 1, 'Property updates do not bypass the reconnect delay');
  runtime.runTimers(3000);
  assert.equal(runtime.scripts.length, 2, 'Reconnect refreshes the installed-only bootstrap');
  const next = connectPublisher(runtime, 'b'.repeat(43));
  next.message({ kind: 'stream', active: true });
  runtime.visibility(true);
  assert.equal(next.closed, true);
  assert.equal(runtime.pendingTimers, 0);
  runtime.visibility(false);
  assert.equal(runtime.scripts.length, 3);
  runtime.window.dispatch('pagehide');
  runtime.runTimers(10_000);
  assert.equal(runtime.pendingTimers, 0);
  assert.equal(runtime.scripts.length, 3);
  runtime.window.dispatch('pageshow');
  assert.equal(runtime.scripts.length, 4);
});
