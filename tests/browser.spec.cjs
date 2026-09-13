const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const nativeProperties = require('../LivelyProperties.json');
const url = pathToFileURL(path.resolve(__dirname, '../grid-wallpaper.html')).href;

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
  expect(await page.evaluate(() => GridWallpaper.getConfig().autoColor)).toBe(false);
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
  const short = await page.locator('#panel button, #panel summary, #panel select, #panel input[type=range], #panel input[type=color], #panel input[type=text], .check-control, #hamburger').evaluateAll(nodes => nodes.filter(n => !n.closest('[hidden]') && n.getBoundingClientRect().height < 48).map(n => n.id || n.tagName));
  expect(short).toEqual([]);
  await page.locator('#hex-bgColor').fill('#zzzzzz');
  await expect(page.locator('#hex-bgColor')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#hex-bgColor').fill('#abcdef');
  expect(await page.evaluate(() => GridWallpaper.getConfig().bgColor)).toBe('#abcdef');
  await page.locator('#panel').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('narrow-settings.png') });
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
    expect(above.y + above.height).toBeLessThanOrEqual(moved.y - 12 + 0.1);
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
  expect(await page.evaluate(() => window.pressRecords.length)).toBe(4);
  expect(await menu.evaluate(button => button.offsetWidth)).toBe(48);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await menu.click(); await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.pressRecords.length)).toBe(4);
  expect(await menu.locator('svg').evaluate(icon => icon.getAnimations().length)).toBe(0);
});

test('Lively WebView2 opens the custom panel link while other hosts keep the inline panel', async ({ page }) => {
  await page.evaluate(() => {
    window.chrome.webview = {};
    window.openedSettings = [];
    window.open = (...args) => window.openedSettings.push(args);
    livelyPropertyListener('count', 5);
  });
  const button = await page.locator('#hamburger').boundingBox();
  const viewport = page.viewportSize();
  await page.locator('#hamburger').click();
  const expectedLink = `grid-wallpaper-settings:open?x=${((button.x + button.width / 2) / viewport.width).toFixed(6)}&y=${((button.y + button.height / 2) / viewport.height).toFixed(6)}`;
  expect(await page.evaluate(() => window.openedSettings)).toEqual([[expectedLink, '_blank']]);
  await expect(page.locator('#panel')).toBeHidden();
  await page.evaluate(() => { delete window.chrome.webview; });
  await page.locator('#hamburger').click();
  await expect(page.locator('#panel')).toBeVisible();
});

test('custom host preserves the panel and confirms only saved revisions', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await page.addInitScript(() => {
    window.GridSettingsWindow = true;
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
  expect(await page.evaluate(() => window.hostMessages)).toEqual([{ kind: 'ready', radius }]);
  expect(await page.evaluate(() => window.animationRequests)).toBe(0);
  await page.evaluate(properties => window.receiveHostMessage({ data: { kind: 'init', properties } }), nativeProperties);
  await expect(page.locator('#setting-count')).toBeEnabled();
  await expect(page.locator('#save-status')).toHaveText('Changes save automatically.');
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
