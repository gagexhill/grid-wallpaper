const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
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
