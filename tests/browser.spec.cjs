// Assertion convention. `expect(locator)` and `expect.poll` retry until they pass;
// a bare `expect(await page.evaluate(...))` reads once and fails immediately. Use a
// retrying form for any value that must BECOME something after an action, so a host
// under load cannot fail the run for scheduling reasons. A one-shot read never proved
// the handler was immediate anyway; it only proved it beat one round trip.
//
// Keep one-shot reads for assertions of absence (nothing was recorded, no frame was
// requested, a collection stayed empty) and for static geometry, where retrying would
// weaken what the assertion means.
const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const nativeProperties = require('../wallpaper/LivelyProperties.json');
const url = pathToFileURL(path.resolve(__dirname, '../wallpaper/grid-wallpaper.html')).href;

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await expect(page).toHaveTitle('Grid Wallpaper');
  await expect.poll(() => page.evaluate(() => !!window.GridWallpaper)).toBe(true);
  page.runtimeErrors = errors;
});
test.afterEach(async ({ page }) => { expect(page.runtimeErrors).toEqual([]); });

test('offline local-file boot, keyboard access and hidden focus boundary', async ({ page, context }) => {
  const remote = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
  await context.setOffline(true);
  await page.reload();
  const menu = page.getByRole('button', { name: 'Open grid settings' });
  await page.keyboard.press('Tab');
  await expect(menu).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Close grid settings', exact: true }).last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(page.locator('#panel')).toBeHidden();
  expect(remote).toEqual([]);
});

test('rapid reopen preserves eight functional presets and canonical controls', async ({ page }) => {
  const menu = page.locator('#hamburger');
  for (let i = 0; i < 4; i++) { await menu.click(); await page.keyboard.press('Escape'); }
  await menu.click();
  await page.getByRole('button', { name: 'Expand all sections' }).click();
  await expect(page.locator('.preset')).toHaveCount(8);
  await page.locator('#setting-autoColor').check();
  await page.getByRole('button', { name: 'Dusk', exact: true }).click();
  await expect.poll(() => page.evaluate(() => GridWallpaper.getConfig().autoColor)).toBe(false);
  await expect(page.locator('#hex-bgColor')).toHaveValue('#2a1f1f');
  await expect(page.locator('#setting-fpsLimit')).toHaveValue('30');
});

test('appearance edits and resize repaint a frozen canvas; browser changes persist', async ({ page }) => {
  await page.evaluate(() => GridWallpaper.update({ snapshot: true, bgColor: '#123456' }));
  await expect.poll(() => page.evaluate(() => [...document.querySelector('#c').getContext('2d').getImageData(1, 1, 1, 1).data].slice(0, 3))).toEqual([18, 52, 86]);
  await page.setViewportSize({ width: 900, height: 600 });
  await expect.poll(() => page.evaluate(() => document.querySelector('#c').getContext('2d').getImageData(1, 1, 1, 1).data[3])).toBe(255);
  await page.reload();
  expect(await page.evaluate(() => GridWallpaper.getConfig().bgColor)).toBe('#123456');
  expect(await page.evaluate(() => GridWallpaper.getConfig().snapshot)).toBe(true);
});

test('native customization applies safely and shows persistent-settings guidance', async ({ page }) => {
  await page.evaluate(() => {
    livelyPropertyListener('bgColor', '#334455');
    livelyPropertyListener('fpsLimit', 0);
    livelyPropertyListener('domeSize3', 1.23);
    livelyWallpaperPlaybackChanged('{"IsPaused":true}');
    livelyWallpaperPlaybackChanged('{"IsPaused":false}');
  });
  await page.locator('#hamburger').click();
  await expect(page.locator('#save-status')).toContainText('Lively > Customize wallpaper');
  const config = await page.evaluate(() => GridWallpaper.getConfig());
  expect(config.fpsLimit).toBe(15);
  expect(config.domeSizes[3]).toBe(1.23);
});

test('320px layout, practical targets, drag-to-bottom and color validation', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const menu = page.locator('#hamburger');
  const bounds = await menu.boundingBox();
  await page.mouse.move(bounds.x + 24, bounds.y + 24);
  await page.mouse.down(); await page.mouse.move(28, 605, { steps: 6 }); await page.mouse.up();
  await menu.click();
  await expect(page.locator('#panel')).toBeVisible();
  await page.getByRole('button', { name: 'Expand all sections' }).click();
  const panel = await page.locator('#panel').boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x + panel.width).toBeLessThanOrEqual(320);
  expect(panel.height).toBeGreaterThan(300);
  const controls = page.locator('#panel button, #panel summary, #panel select, #panel input[type=range], #panel input[type=color], #panel input[type=text], .check-control, #hamburger');
  await expect.poll(() => controls.evaluateAll(nodes => nodes.filter(n => !n.closest('[hidden]') && n.getBoundingClientRect().height < 48).map(n => ({ control: n.id || n.textContent.trim(), height: n.getBoundingClientRect().height })))).toEqual([]);
  await page.locator('#hex-bgColor').fill('#zzzzzz');
  await expect(page.locator('#hex-bgColor')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#hex-bgColor').fill('#abcdef');
  await expect.poll(() => page.evaluate(() => GridWallpaper.getConfig().bgColor)).toBe('#abcdef');
  await page.locator('#panel').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('narrow-settings.png') });
});

test('inline dragging follows fast movement outside the button when capture is unavailable', async ({ page }) => {
  const menu = page.locator('#hamburger');
  await menu.evaluate(button => { button.setPointerCapture = () => { throw new DOMException('Unavailable', 'NotFoundError'); }; });
  const start = await menu.boundingBox();
  await page.mouse.move(start.x + 24, start.y + 24);
  await page.mouse.down();
  await page.mouse.move(130, 430);
  const moving = await menu.boundingBox();
  expect(moving.x).toBeCloseTo(106, 0);
  expect(moving.y).toBeCloseTo(406, 0);
  await page.mouse.up();
  const stopped = await menu.boundingBox();
  expect(stopped.x).toBe(16);
  await page.mouse.move(stopped.x + 24, stopped.y + 24);
  await page.mouse.move(400, 200);
  expect(await menu.boundingBox()).toEqual(stopped);
  await expect(page.locator('#panel')).toBeHidden();
  await menu.click();
  await expect(page.locator('#panel')).toBeVisible();
});

test('inline drag cancellation and lost mouse release never resume on hover', async ({ page }) => {
  const results = await page.evaluate(() => {
    const button = document.getElementById('hamburger');
    const results = [];
    for (const reason of ['pointercancel', 'lostpointercapture', 'blur', 'pointerout', 'released']) {
      const start = button.getBoundingClientRect();
      const pointer = { pointerId: 81, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, bubbles: true };
      button.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, clientX: start.x + 24, clientY: start.y + 24 }));
      window.dispatchEvent(new PointerEvent('pointermove', { ...pointer, clientX: 250, clientY: 250 }));
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else if (reason === 'released') window.dispatchEvent(new PointerEvent('pointermove', { ...pointer, buttons: 0, clientX: 300, clientY: 300 }));
      else (reason === 'lostpointercapture' ? button : window).dispatchEvent(new PointerEvent(reason, pointer));
      const stopped = button.getBoundingClientRect().toJSON();
      button.dispatchEvent(new PointerEvent('pointermove', { ...pointer, buttons: 0, clientX: 600, clientY: 500 }));
      window.dispatchEvent(new PointerEvent('pointermove', { ...pointer, clientX: 650, clientY: 550 }));
      results.push({ reason, stopped: JSON.stringify(stopped) === JSON.stringify(button.getBoundingClientRect().toJSON()), dragging: button.classList.contains('dragging') });
    }
    return results;
  });
  expect(results.every(result => result.stopped && !result.dragging)).toBe(true);
});

test('open panel follows its button during drag and snapping, then dismisses outside', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1200 });
  const menu = page.locator('#hamburger');
  const panel = page.locator('#panel');
  await menu.click();
  await page.locator('details').evaluateAll(sections => sections.forEach(section => { section.open = false; }));
  const start = await menu.boundingBox();
  await page.mouse.move(start.x + 24, start.y + 24);
  await page.mouse.down();
  await page.mouse.move(900, 200);
  const moving = await panel.boundingBox();
  expect(moving.x + moving.width).toBeCloseTo(900, 0);
  expect(moving.y).toBeCloseTo(200, 0);
  await page.mouse.up();
  await expect(panel).toBeVisible();
  const snappedButton = await menu.boundingBox();
  const snappedPanel = await panel.boundingBox();
  expect(snappedPanel.x + snappedPanel.width).toBeCloseTo(snappedButton.x + 24, 0);
  await page.mouse.click(600, 10);
  await expect(panel).toBeHidden();
});

test('settings motion preserves immediate values and respects reduced motion', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#hamburger').click();
  await page.getByRole('button', { name: 'Expand all sections' }).click();
  await expect(page.locator('#setting-vignette')).toBeChecked();
  await page.locator('#setting-vignette').uncheck();
  await expect.poll(() => page.evaluate(() => GridWallpaper.getConfig().vignette)).toBe(false);
  await expect.poll(() => page.locator('#setting-vignette').evaluate(input => getComputedStyle(input, '::after').transitionDuration)).toBe('0.14s, 0.14s');
  await page.locator('#setting-sizeScale').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#setting-sizeScale')).toHaveValue('1.05');
  await expect.poll(() => page.evaluate(() => GridWallpaper.getConfig().sizeScale)).toBe(1.05);
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await expect(page.locator('#setting-vignette')).toBeChecked();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.locator('#setting-vignette').evaluate(input => getComputedStyle(input, '::after').transitionDuration)).toBe('0s');
  await expect.poll(() => page.locator('#dome-controls').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await page.locator('#panel').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('restored-settings-motion.png') });
});

test('live dome rails show actual rendered sizes while focus edits only the saved base', async ({ page }) => {
  await page.locator('#hamburger').click();
  await page.getByText('Individual dome sizes', { exact: true }).click();
  await page.evaluate(() => GridWallpaper.update({ autoSize: true, snapshot: false }));
  await expect(page.locator('#dome-size-status')).toContainText('Sliders show live sizes.');
  const before = await page.evaluate(() => {
    window.domeUiSamples = [];
    window.stopDomeUiSamples = GridWallpaper.subscribeDomeState(state => {
      if (!state) return;
      const input = document.getElementById('dome-size-0');
      window.domeUiSamples.push({ sequence: state.sequence, size: state.sizes[0], base: state.bases[0],
        rail: Number(input.value), minimum: input.min, progress: input.style.getPropertyValue('--range-progress'),
        output: input.closest('.control').querySelector('output').textContent });
    });
    return { config: GridWallpaper.getConfig(), storage: localStorage.getItem('grid-wallpaper.settings.v1') };
  });
  await expect.poll(() => page.evaluate(() => window.domeUiSamples.length)).toBeGreaterThanOrEqual(8);
  const sampled = await page.evaluate(() => {
    window.stopDomeUiSamples();
    return { samples: window.domeUiSamples, config: GridWallpaper.getConfig(), storage: localStorage.getItem('grid-wallpaper.settings.v1') };
  });
  expect(sampled.config).toEqual(before.config);
  expect(sampled.storage).toBe(before.storage);
  expect(new Set(sampled.samples.map(sample => sample.size)).size).toBeGreaterThan(1);
  for (const sample of sampled.samples) {
    expect(sample.base).toBe(before.config.domeSizes[0]);
    expect(sample.minimum).toBe('0');
    expect(Math.abs(sample.rail - sample.size)).toBeLessThanOrEqual(0.005001);
    expect(sample.output).toBe(`${sample.size.toFixed(2)}×`);
    expect(Number.parseFloat(sample.progress)).toBeCloseTo(sample.size / 3 * 100, 5);
  }
  const rail = page.locator('#dome-size-0');
  await rail.focus();
  await expect(rail).toHaveValue(String(before.config.domeSizes[0]));
  await expect(rail).toHaveAttribute('min', '0.1');
  await expect(rail).not.toHaveAttribute('aria-valuetext', /Live size/);
  await page.keyboard.press('ArrowRight');
  const edited = Number((before.config.domeSizes[0] + 0.01).toFixed(2));
  await expect.poll(() => page.evaluate(() => GridWallpaper.getConfig().domeSizes[0])).toBe(edited);
  await page.locator('#close-settings').focus();
  await expect(rail).toHaveAttribute('aria-valuetext', /Live size/);
  await expect.poll(() => page.evaluate(() => GridWallpaper.getDomeState()?.bases[0])).toBe(edited);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('grid-wallpaper.settings.v1')).domeSizes[0])).toBe(edited);
});

test('panel content motion never delays input and cancels on closing or reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const opened = await page.evaluate(() => {
    document.getElementById('hamburger').click();
    const panel = document.getElementById('panel');
    const animations = Array.from(panel.children).flatMap(node => node.getAnimations());
    animations.forEach(animation => { animation.pause(); });
    window.contentMotion = animations;
    const input = document.getElementById('setting-speedScale');
    input.value = '1.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { visible: !panel.hidden, inert: panel.inert, disabled: input.disabled,
      value: GridWallpaper.getConfig().speedScale, animations: animations.length,
      duration: Math.max(...animations.map(animation => animation.effect.getTiming().duration)) };
  });
  expect(opened).toMatchObject({ visible: true, inert: false, disabled: false, value: 1.5 });
  expect(opened.animations).toBeGreaterThan(0);
  expect(opened.duration).toBeLessThanOrEqual(180);
  const closed = await page.evaluate(() => {
    document.getElementById('close-settings').click();
    return { hidden: document.getElementById('panel').hidden,
      canceled: window.contentMotion.every(animation => animation.playState === 'idle') };
  });
  expect(closed).toEqual({ hidden: true, canceled: true });
  await page.evaluate(() => {
    document.getElementById('hamburger').click();
    window.contentMotion = Array.from(document.getElementById('panel').children).flatMap(node => node.getAnimations());
    window.contentMotion.forEach(animation => animation.pause());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => window.contentMotion.every(animation => animation.playState === 'idle'))).toBe(true);
  const reduced = await page.evaluate(() => {
    document.getElementById('close-settings').click();
    document.getElementById('hamburger').click();
    const panel = document.getElementById('panel');
    return { visible: !panel.hidden, inert: panel.inert,
      animations: Array.from(panel.children).flatMap(node => node.getAnimations()).length };
  });
  expect(reduced).toEqual({ visible: true, inert: false, animations: 0 });
});

test('reduced-motion first run freezes and blocked storage remains usable', async ({ page, context }) => {
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  expect(await page.evaluate(() => GridWallpaper.getConfig().snapshot)).toBe(true);
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
  await page.reload();
  await page.locator('#hamburger').click();
  await expect(page.locator('#save-status')).toContainText('storage is unavailable');
  await page.evaluate(() => GridWallpaper.update({ count: 2 }));
  expect(await page.evaluate(() => GridWallpaper.getConfig().count)).toBe(2);
});

for (const display of [
  { name: 'primary display', x: 0, y: 0, width: 1280, height: 800, workHeight: 752, scale: 1 },
  { name: 'scaled display with negative origin', x: -1536, y: -120, width: 1536, height: 960, workHeight: 900, scale: 1.2 }
]) {
  test(`settings clear the taskbar on ${display.name}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(display => {
      for (const [key, value] of Object.entries({ width: display.width, height: display.height,
        availLeft: display.x, availTop: display.y, availWidth: display.width, availHeight: display.workHeight })) {
        Object.defineProperty(screen, key, { configurable: true, value });
      }
      for (const [key, value] of Object.entries({ screenX: display.x, screenY: display.y,
        outerWidth: display.width, outerHeight: display.height })) {
        Object.defineProperty(window, key, { configurable: true, value });
      }
      livelyPropertyListener('count', 5);
    }, display);
    const bottom = display.workHeight / display.scale;
    const menu = page.locator('#hamburger');
    await menu.click();
    await page.getByRole('button', { name: 'Expand all sections' }).click();
    const panel = await page.locator('#panel').boundingBox();
    expect(panel.y + panel.height).toBeLessThanOrEqual(bottom - 16 + 0.1);
    await page.keyboard.press('Escape');
    const button = await menu.boundingBox();
    await page.mouse.move(button.x + 24, button.y + 24);
    await page.mouse.down(); await page.mouse.move(1260, 790, { steps: 6 }); await page.mouse.up();
    const moved = await menu.boundingBox();
    expect(moved.y + moved.height).toBeLessThanOrEqual(bottom - 16 + 0.1);
    await menu.click();
    const above = await page.locator('#panel').boundingBox();
    expect(above.y + above.height).toBeLessThanOrEqual(bottom - 16 + 0.1);
    expect(above.y).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: info.outputPath('taskbar-clearance.png') });
  });
}

test('settings opening and closing have press feedback without shrinking the hit area', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    const icon = document.querySelector('#hamburger svg');
    window.pressRecords = [];
    const animate = icon.animate.bind(icon);
    icon.animate = (...args) => { window.pressRecords.push(args); return animate(...args); };
  });
  const menu = page.locator('#hamburger');
  await menu.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Close grid settings', exact: true }).last().click();
  await expect.poll(() => page.evaluate(() => window.pressRecords.length)).toBe(4);
  expect(await menu.evaluate(button => button.offsetWidth)).toBe(48);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await menu.click(); await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.pressRecords.length)).toBe(4);
  expect(await menu.locator('svg').evaluate(icon => icon.getAnimations().length)).toBe(0);
});

test('Lively WebView2 uses the native launcher while other hosts keep the inline panel', async ({ page }) => {
  await page.evaluate(() => {
    window.chrome.webview = {};
    window.openedSettings = [];
    window.open = (...args) => window.openedSettings.push(args);
    livelyPropertyListener('count', 5);
  });
  await expect(page.locator('#hamburger')).toBeHidden();
  await page.locator('#hamburger').evaluate(button => button.click());
  expect(await page.evaluate(() => window.openedSettings)).toEqual([]);
  await expect(page.locator('#panel')).toBeHidden();
  await page.evaluate(() => { delete window.chrome.webview; livelyPropertyListener('count', 6); });
  await expect(page.locator('#hamburger')).toBeVisible();
  await page.locator('#hamburger').click();
  await expect(page.locator('#panel')).toBeVisible();
});

test('custom host preserves the panel and confirms only saved revisions', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await page.addInitScript(() => {
    window.GridSettingsWindow = true;
    Object.defineProperty(window, 'devicePixelRatio', { value: 1.25 });
    window.hostMessages = [];
    window.animationRequests = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => { window.animationRequests++; return raf(callback); };
    window.chrome.webview = {
      postMessage: message => window.hostMessages.push(message),
      addEventListener: (kind, listener) => { if (kind === 'message') window.receiveHostMessage = listener; }
    };
  });
  await page.reload();
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#hamburger')).toBeHidden();
  await expect(page.locator('#setting-count')).toBeDisabled();
  const radius = await page.locator('#panel').evaluate(panel => Number.parseFloat(getComputedStyle(panel).borderTopRightRadius));
  const messages = await page.evaluate(() => window.hostMessages);
  expect(messages).toHaveLength(1);
  const appearance = messages[0];
  expect(appearance.kind).toBe('ready');
  expect(appearance.radius).toBe(radius);
  expect(appearance.launcher.width).toBeGreaterThanOrEqual(48);
  expect(appearance.launcher.height).toBeGreaterThanOrEqual(48);
  expect(appearance.launcher.frames).toHaveLength(6);
  expect(Buffer.byteLength(JSON.stringify(appearance))).toBeLessThanOrEqual(65536);
  const pixels = await page.evaluate(async launcher => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(launcher.frames[0]), character => character.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const alpha = context.getImageData(0, 0, 1, 1).data[3];
    return { width: image.width, height: image.height, alpha, ratio: devicePixelRatio };
  }, appearance.launcher);
  expect(pixels.width).toBe(Math.round(appearance.launcher.width * pixels.ratio));
  expect(pixels.height).toBe(Math.round(appearance.launcher.height * pixels.ratio));
  expect(pixels.alpha).toBe(0);
  expect(new Set(appearance.launcher.frames).size).toBe(6);
  expect(await page.evaluate(() => window.animationRequests)).toBe(0);
  await page.evaluate(properties => window.receiveHostMessage({ data: { kind: 'init', properties } }), nativeProperties);
  await expect(page.locator('#setting-count')).toBeEnabled();
  await expect(page.locator('#save-status')).toHaveText('Changes save automatically.');
  await page.evaluate(() => window.receiveHostMessage({ data: { kind: 'shown', sequence: 1 } }));
  await expect.poll(() => page.evaluate(() => window.hostMessages.at(-1))).toEqual({ kind: 'interactive', sequence: 1 });
  await page.evaluate(() => {
    window.receiveHostMessage({ data: { kind: 'loading' } });
    window.receiveHostMessage({ data: { kind: 'shown', sequence: 2 } });
    window.receiveHostMessage({ data: { kind: 'hidden' } });
  });
  await page.evaluate(properties => window.receiveHostMessage({ data: { kind: 'init', properties } }), nativeProperties);
  expect(await page.evaluate(() => window.hostMessages.filter(message => message.kind === 'interactive').map(message => message.sequence))).toEqual([1]);
  await page.getByRole('button', { name: 'Expand all sections' }).click();
  await expect(page.locator('.preset')).toHaveCount(8);
  await page.getByRole('button', { name: 'Dusk', exact: true }).click();
  const change = await page.evaluate(() => window.hostMessages.at(-1));
  expect(change.kind).toBe('change');
  expect(change.properties.bgColor).toBe('#2a1f1f');
  expect(Number.isSafeInteger(change.revision)).toBe(true);
  await expect(page.locator('#save-status')).toHaveText('Saving changes…');
  await page.evaluate(revision => window.receiveHostMessage({ data: { kind: 'saved', revision: revision - 1 } }), change.revision);
  await expect(page.locator('#save-status')).toHaveText('Saving changes…');
  await page.evaluate(revision => window.receiveHostMessage({ data: { kind: 'saved', revision } }), change.revision);
  await expect(page.locator('#save-status')).toHaveText('Changes saved.');
  await page.evaluate(() => window.receiveHostMessage({ data: { kind: 'error', message: 'A test save failed.' } }));
  await page.evaluate(() => GridWallpaper.update({ count: 2 }));
  const retry = await page.evaluate(() => window.hostMessages.at(-1));
  expect(retry.properties.count).toBe(2);
  expect(retry.properties.bgColor).toBe('#2a1f1f');
  const panel = await page.locator('#panel').boundingBox();
  expect(panel).toEqual({ x: 0, y: 0, width: 360, height: 700 });
  await page.locator('#panel').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('custom-settings-panel.png') });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.hostMessages.at(-1))).toEqual({ kind: 'close' });
  await page.evaluate(() => window.receiveHostMessage({ data: { kind: 'closing' } }));
  await expect(page.locator('#setting-count')).toBeDisabled();
  await expect(page.locator('#save-status')).toHaveText('Saving before closing…');
  await page.evaluate(() => window.receiveHostMessage({ data: { kind: 'error', message: 'Could not save before closing.' } }));
  await expect(page.locator('#setting-count')).toBeEnabled();
});

async function loadTelemetryPanel(page, telemetryAvailable = true) {
  await page.addInitScript(() => {
    window.GridSettingsWindow = true;
    window.hostMessages = [];
    window.chrome.webview = {
      postMessage: message => window.hostMessages.push(message),
      addEventListener: (kind, listener) => { if (kind === 'message') window.receiveHostMessage = listener; }
    };
  });
  await page.reload();
  const properties = structuredClone(nativeProperties);
  properties.autoSize.value = true;
  await page.evaluate(({ properties, telemetryAvailable }) => {
    window.receiveHostMessage({ data: { kind: 'init', properties, telemetryAvailable } });
  }, { properties, telemetryAvailable });
  await expect(page.locator('#setting-autoSize')).toBeEnabled();
}

const observationMessages = page => page.evaluate(() => window.hostMessages.filter(message => message.kind === 'observe-domes'));

test('native telemetry observes only a shown panel with its dome section open and automatic sizing enabled', async ({ page }) => {
  await loadTelemetryPanel(page);
  const summary = page.getByText('Individual dome sizes', { exact: true });
  await summary.click();
  expect(await observationMessages(page)).toEqual([]);
  await page.evaluate(() => window.receiveHostMessage({ data: { kind: 'shown', sequence: 1 } }));
  await expect.poll(() => observationMessages(page)).toEqual([{ kind: 'observe-domes', active: true }]);
  await summary.click();
  await expect.poll(async () => (await observationMessages(page)).at(-1)).toEqual({ kind: 'observe-domes', active: false });
  await summary.click();
  await expect.poll(async () => (await observationMessages(page)).at(-1)).toEqual({ kind: 'observe-domes', active: true });
  await page.evaluate(() => window.receiveHostMessage({ data: { kind: 'hidden' } }));
  await expect.poll(async () => (await observationMessages(page)).at(-1)).toEqual({ kind: 'observe-domes', active: false });
  const hiddenCount = (await observationMessages(page)).length;
  await summary.click();
  await summary.click();
  expect((await observationMessages(page)).length).toBe(hiddenCount);
  await page.evaluate(() => window.receiveHostMessage({ data: { kind: 'shown', sequence: 2 } }));
  await expect.poll(async () => (await observationMessages(page)).at(-1)).toEqual({ kind: 'observe-domes', active: true });
  await page.locator('#setting-autoSize').uncheck();
  await expect.poll(async () => (await observationMessages(page)).at(-1)).toEqual({ kind: 'observe-domes', active: false });
  await page.locator('#setting-autoSize').check();
  await expect.poll(async () => (await observationMessages(page)).at(-1)).toEqual({ kind: 'observe-domes', active: true });
  await page.evaluate(() => window.receiveHostMessage({ data: { kind: 'closing' } }));
  await expect.poll(async () => (await observationMessages(page)).at(-1)).toEqual({ kind: 'observe-domes', active: false });
  expect(await page.evaluate(() => GridWallpaper.getDomeState())).toBeNull();
});

test('native live rails reject stale data, preserve base editing and never turn telemetry into saved changes', async ({ page }) => {
  await loadTelemetryPanel(page);
  await page.getByText('Individual dome sizes', { exact: true }).click();
  await page.evaluate(() => window.receiveHostMessage({ data: { kind: 'shown', sequence: 1 } }));
  await expect.poll(async () => (await observationMessages(page)).at(-1)).toEqual({ kind: 'observe-domes', active: true });
  const before = await page.evaluate(() => ({ config: GridWallpaper.getConfig(),
    storage: localStorage.getItem('grid-wallpaper.settings.v1'),
    changes: window.hostMessages.filter(message => message.kind === 'change').length }));
  const bases = before.config.domeSizes.slice(0, before.config.count);
  const frame = { kind: 'domes', sequence: 1, autoSize: true, paused: false, bases,
    sizes: bases.map(base => base * 0.7), screen: { left: 0, top: 0, width: 1920, height: 1040, scale: 1 } };
  const send = state => page.evaluate(state => window.receiveHostMessage({ data: { kind: 'dome-state', state } }), state);
  await send(frame);
  const rail = page.locator('#dome-size-0');
  await expect(rail).toHaveValue('0.7');
  await expect(rail).toHaveAttribute('aria-valuetext', 'Live size 0.70×; base 1.00×');
  const rejected = [
    { ...frame, sizes: bases.map(base => base * 0.9) },
    { ...frame, sequence: 2, bases: [2, ...bases.slice(1)] },
    { ...frame, sequence: 2, sizes: [99, ...frame.sizes.slice(1)] },
    { ...frame, sequence: 2, autoSize: false }
  ];
  for (const invalid of rejected) {
    await send(invalid);
    await expect(rail).toHaveValue('0.7');
  }
  await send({ ...frame, sequence: 2, paused: true, sizes: bases.map(base => base * 0.8) });
  await expect(rail).toHaveValue('0.8');
  await expect(page.locator('#dome-size-status')).toContainText('Live sizes are paused.');
  expect(await page.evaluate(() => GridWallpaper.getConfig())).toEqual(before.config);
  expect(await page.evaluate(() => localStorage.getItem('grid-wallpaper.settings.v1'))).toBe(before.storage);
  expect(await page.evaluate(() => window.hostMessages.filter(message => message.kind === 'change').length)).toBe(before.changes);
  await rail.focus();
  await expect(rail).toHaveValue('1');
  await send({ ...frame, sequence: 3, sizes: bases.map(base => base * 0.6) });
  await expect(rail).toHaveValue('1');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => GridWallpaper.getConfig().domeSizes[0])).toBe(1.01);
  const changes = await page.evaluate(() => window.hostMessages.filter(message => message.kind === 'change'));
  expect(changes).toHaveLength(before.changes + 1);
  expect(changes.at(-1).properties).toEqual({ domeSize0: 1.01 });
  await page.locator('#close-settings').focus();
  await expect(rail).toHaveValue('1.01');
  await send({ ...frame, sequence: 4 });
  await expect(rail).toHaveValue('1.01');
  await expect(rail).not.toHaveAttribute('aria-valuetext', /Live size/);
  const updatedBases = [1.01, ...bases.slice(1)];
  await send({ ...frame, sequence: 5, bases: updatedBases, sizes: updatedBases.map(base => base * 0.7) });
  await expect(rail).toHaveAttribute('aria-valuetext', 'Live size 0.71×; base 1.01×');
  await send(null);
  await expect(rail).toHaveValue('1.01');
  await expect(page.locator('#dome-size-status')).toContainText('Waiting for live sizes.');
  expect(await page.evaluate(() => window.hostMessages.filter(message => message.kind === 'change').length)).toBe(changes.length);
  await page.evaluate(() => window.receiveHostMessage({ data: { kind: 'hidden' } }));
  await send({ ...frame, sequence: 6, bases: updatedBases, sizes: updatedBases.map(base => base * 0.9) });
  await expect(rail).toHaveValue('1.01');
  expect(await page.evaluate(() => window.hostMessages.filter(message => message.kind === 'change').length)).toBe(changes.length);
});
